require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const port = process.env.PORT || 5000;
const app = express();
const stripe = require("stripe")(process.env.SECRET_KEY_STRIPE);

app.use(express.json());
app.use(cors());
app.use((req, res, next) => {
    console.log(`A request from ${req.hostname} || ${req.method} - ${req.url} at ${new Date().toLocaleTimeString()}`);
    next();
})

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.ybs8l.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        const userCollection = client.db("popularMedicalDB").collection("users");
        const campCollection = client.db("popularMedicalDB").collection("camps");
        const participantCollection = client.db("popularMedicalDB").collection("participants");
        const feedbackCollection = client.db("popularMedicalDB").collection("feedbacks");
        const paymentCollection = client.db("popularMedicalDB").collection("payments");
        const imageCollection = client.db("popularMedicalDB").collection("aiImages");

        const verifyToken = (req, res, next) => {
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'Unauthorized Access' })
            }

            const token = req.headers.authorization.split(' ')[1];

            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
                if (error) {
                    return res.status(401).send({ message: 'Unauthorized Access' })
                }

                req.decoded = decoded;
                next();
            })
        };

        // Verify Organizer after verifyToken
        const verifyOrganizer = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };

            const user = await userCollection.findOne(query);
            const isOrganizer = user?.role === 'Organizer';

            if (!isOrganizer) {
                return res.status(403).send({ message: "Forbidden Access" });
            }

            next();
        };

        //   JWT API
        app.post("/jwt-access", (req, res) => {
            const userEmail = req.body;
            const token = jwt.sign(userEmail, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "24h" });

            res.send({ token });
        });

        // Users collection
        app.get("/users", verifyToken, async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        });

        app.get("/user/organizer/:email", async (req, res) => {
            const organizerEmail = req.params.email;
            const query = { email: organizerEmail };

            const findUser = await userCollection.findOne(query);
            if (findUser?.role === "Organizer") {
                res.send(findUser);
            }
        });

        app.get("/user/participant/:email", async (req, res) => {
            const participantEmail = req.params.email;
            const query = { email: participantEmail };

            const findParticipant = await userCollection.findOne(query);
            if (findParticipant?.role === "Participant") {
                res.send(findParticipant);
            }
        });

        app.get("/organizer/:email", async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const loggedInUser = await userCollection.findOne(query);

            let organizer = false;
            if (loggedInUser) {
                organizer = loggedInUser?.role === "Organizer"
            }

            res.send({ organizer });
        });

        app.post("/users", async (req, res) => {
            const usersData = req.body;
            const query = { email: usersData?.email };
            const existingUser = await userCollection.findOne(query);

            if (existingUser) {
                return res.send({ message: 'User already exists', insertedId: null });
            }

            const result = await userCollection.insertOne(usersData);
            res.send(result);
        });

        app.patch("/organizer/update-profile/:id", verifyToken, verifyOrganizer, async (req, res) => {
            const organizerData = req.body;
            const organizerId = req.params.id;
            const filter = { _id: new ObjectId(organizerId) };

            const updateData = {
                $set: {
                    name: organizerData?.name,
                    image: organizerData?.image,
                    contact: organizerData?.contact
                }
            }

            const updateResult = await userCollection.updateOne(filter, updateData);
            res.send(updateResult);
        });

        app.patch("/participant/update-profile/:id", verifyToken, async (req, res) => {
            const participantData = req.body;
            const participantId = req.params.id;
            const filter = { _id: new ObjectId(participantId) };

            const updateData = {
                $set: {
                    name: participantData?.name,
                    image: participantData?.image,
                    contact: participantData?.contact
                }
            }

            const updateResult = await userCollection.updateOne(filter, updateData);
            res.send(updateResult);
        });

        // Payment Intent
        app.post("/create-payment-intent", verifyToken, async (req, res) => {
            const { campFee } = req.body;
            const amount = parseInt(campFee * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"]
            })

            res.send({ clientSecret: paymentIntent.client_secret })
        });

        // Payments
        app.get("/payment-history/:email", verifyToken, async (req, res) => {
            const email = req.params.email;
            const search = req.query.search || "";
            const page = parseInt(req.query.page);
            const size = parseInt(req.query.size);

            const findPaymentHistory = await paymentCollection.aggregate([
                {
                    $match: { email: email }
                },
                {
                    $addFields: {
                        campId: { $toObjectId: '$campId' }
                    }
                },
                {
                    $lookup: {
                        from: 'participants',
                        localField: 'campId',
                        foreignField: '_id',
                        as: 'payments'
                    }
                },
                { $unwind: '$payments' },
                {
                    $addFields: {
                        campName: '$payments.campName',
                        campFees: '$payments.campFees',
                        paymentStatus: '$payments.paymentStatus',
                        confirmationStatus: '$payments.confirmationStatus',
                    }
                },
                {
                    $match: {
                        $or: [
                            { campName: { $regex: search, $options: "i" } },
                            { campFees: { $regex: search, $options: "i" } },
                            {
                                paymentStatus: { $regex: search, $options: "i" }
                            },
                            {
                                confirmationStatus: { $regex: search, $options: "i" }
                            }
                        ]
                    }
                },
                {
                    $project: { payments: 0 }
                }
            ]).skip(page * size).limit(size).toArray();
            res.send(findPaymentHistory);
        });

        app.get("/history-count", async (req, res) => {
            const count = await paymentCollection.estimatedDocumentCount();
            res.send({ count });
        });

        app.post("/payments", verifyToken, async (req, res) => {
            const paymentInfo = req.body;
            const insertResult = await paymentCollection.insertOne(paymentInfo);

            const campId = paymentInfo.campId;
            const query = { _id: new ObjectId(campId) };

            let updateStatus = {
                $set: {
                    paymentStatus: "Paid"
                }
            }

            const updatePaymentStatus = await paymentCollection.updateOne(query, updateStatus);

            const updateResult = await participantCollection.updateOne(query, updateStatus);
            res.send({ insertResult, updateResult, updatePaymentStatus });
        });

        // APIs of Dashboard
        app.get("/organizer-stats", verifyToken, verifyOrganizer, async (req, res) => {
            const users = await userCollection.estimatedDocumentCount();
            const camps = await campCollection.estimatedDocumentCount();
            const registers = await paymentCollection.estimatedDocumentCount();

            const result = await paymentCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalFees: { $sum: { $toDouble: "$campFees" } }
                    }
                }
            ]).toArray();

            const fees = result.length > 0 ? result[0].totalFees : 0;

            res.send({ users, camps, registers, fees });
        });

        app.get("/participant-stats", verifyToken, async (req, res) => {
            const userEmail = req.query.email;

            if (!userEmail) {
                return res.status(400).send({ message: "Email is required" });
            }

            const result = await paymentCollection.aggregate([
                {
                    $match: { email: userEmail } // Filter data by user's email
                },
                {
                    $group: {
                        _id: null,
                        totalRevenue: { $sum: { $toDouble: "$campFees" } }, // Sum of all campFees
                        totalRegisteredCamps: { $sum: 1 }, // Count registrations
                    }
                }
            ]).toArray();

            const fees = result.length > 0 ? result[0].totalRevenue : 0;
            const registers = result.length > 0 ? result[0].totalRegisteredCamps : 0;

            res.send({ registers, fees });
        });

        app.get("/registers-stats", verifyToken, verifyOrganizer, async (req, res) => {
            const findPaymentData = await paymentCollection.find({}).toArray();

            const campData = await campCollection.find().toArray();
            const chartData = findPaymentData.map((payment) => {
                const camp = campData.find((c) => c.campName === payment.campName);
                return {
                    ...payment,
                    participantCount: camp ? camp.participantCount : 0,
                };
            });

            res.send(chartData);
        });

        // Participant Analytics
        app.get("/analytics/:email", verifyToken, async (req, res) => {
            const userEmail = req.params.email;
            const findParticipantData = await participantCollection.find({ participantEmail: userEmail }).toArray();

            const campData = await campCollection.find().toArray();
            const analyticsData = findParticipantData.map((participant) => {
                const camp = campData.find((c) => c.campName === participant.campName);
                return {
                    ...participant,
                    participantCount: camp ? camp.participantCount : 0,
                };
            });

            res.send(analyticsData);
        });

        // Camps collection
        app.get("/camps", async (req, res) => {
            const { search, sorted } = req.query;
            const page = parseInt(req.query.page);
            const size = parseInt(req.query.size);

            let searchOptions = {
                $or: [
                    { campName: { $regex: search, $options: "i" } },
                    { dateTime: { $regex: search, $options: "i" } },
                    {
                        professionalName: { $regex: search, $options: "i" }
                    }
                ]
            };

            let sortOption = {};
            if (sorted === "participantCount") {
                sortOption = { participantCount: -1 }
            }

            if (sorted === "fees") {
                sortOption = { fees: -1 }
            }

            if (sorted === "campName") {
                sortOption = { campName: 1 }
            }

            const findCamps = campCollection.find(searchOptions).sort(sortOption);
            const result = await findCamps.skip(page * size).limit(size).toArray();
            res.send(result);
        });

        app.get("/popular-camps", async (req, res) => {
            const sortCount = { participantCount: - 1 };

            const findCamps = campCollection.find({});
            const popularCamps = await findCamps.sort(sortCount).limit(6).toArray();
            res.send(popularCamps);
        });

        app.get("/affordable-camps", async (req, res) => {
            const sortedByPrice = { fees: 1 };

            const findCamps = campCollection.find({});
            const affordableCamps = await findCamps.sort(sortedByPrice).limit(6).toArray();
            res.send(affordableCamps);
        });

        app.put("/update-camp/:campId", verifyToken, verifyOrganizer, async (req, res) => {
            const { campId } = req.params;
            const query = { _id: new ObjectId(campId) };
            const campData = req.body;
            const updateCamp = { $set: campData };

            const updateResult = await campCollection.updateOne(query, updateCamp);
            res.send(updateResult);
        });

        app.delete("/delete-camp/:campId", verifyToken, verifyOrganizer, async (req, res) => {
            const { campId } = req.params;
            const filter = { _id: new ObjectId(campId) };
            const deleteResult = await campCollection.deleteOne(filter);
            res.send(deleteResult);
        });

        app.get("/camp/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            const findResult = await campCollection.findOne(query);
            if (!findResult) {
                return res.status(404).send({ message: "Camp Not Found" })
            }

            res.send(findResult);
        });

        app.get("/camps-count", async (req, res) => {
            const count = await campCollection.estimatedDocumentCount();
            res.send({ count });
        });

        app.get("/participants-count", async (req, res) => {
            const count = await participantCollection.estimatedDocumentCount();
            res.send({ count });
        });

        app.post("/camps", verifyToken, verifyOrganizer, async (req, res) => {
            const campData = req.body;
            const insertResult = await campCollection.insertOne(campData);
            res.send(insertResult);
        });

        app.patch("/participant-count/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };

            const updateParticipantCount = { $inc: { participantCount: 1 } }
            const updateResult = await campCollection.updateOne(filter, updateParticipantCount);
            res.send(updateResult);
        });

        // Participants collection
        app.get("/participants", verifyToken, verifyOrganizer, async (req, res) => {
            const search = req.query.search || "";
            const page = parseInt(req.query.page);
            const size = parseInt(req.query.size);

            const findParticipantData = await participantCollection.aggregate([
                {
                    $sort: { campFees: -1 }
                },
                {
                    $lookup: {
                        from: 'payments',
                        localField: '_id',
                        foreignField: 'paymentStatus',
                        as: 'payments'
                    }
                },
                {
                    $unwind: {
                        path: "$payments",
                        preserveNullAndEmptyArrays: true,
                    }
                },
                {
                    $match: {
                        $or: [
                            { participantName: { $regex: search, $options: "i" } },
                            { campName: { $regex: search, $options: "i" } },
                            { campFees: { $regex: search, $options: "i" } },
                            {
                                paymentStatus: { $regex: search, $options: "i" }
                            },
                            {
                                confirmationStatus: { $regex: search, $options: "i" }
                            }
                        ]
                    }
                },
                // {
                //     $project: { payments: 0 }
                // },
                // {
                //     $skip: page * size
                // },
                // {
                //     $limit: size
                // }
            ]).skip(page * size)
                .limit(size)
                .toArray();

            res.send(findParticipantData);
        });

        app.get("/joined-camps-count", async (req, res) => {
            const count = await participantCollection.estimatedDocumentCount();
            res.send({ count });
        });

        app.get("/registered-camps/:email", verifyToken, async (req, res) => {
            const email = req.params.email;
            const search = req.query.search || "";
            const page = parseInt(req.query.page);
            const size = parseInt(req.query.size);

            const query = {
                participantEmail: email, $or: [
                    { campName: { $regex: search, $options: "i" } },
                    { campFees: { $regex: search, $options: "i" } },
                    {
                        paymentStatus: { $regex: search, $options: "i" }
                    }
                ]
            };

            const findRegisteredCamps = await participantCollection.find(query).skip(page * size).limit(size).toArray();
            res.send(findRegisteredCamps);
        });

        app.get("/participant/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            const findResult = await participantCollection.findOne(query);
            if (!findResult) {
                return res.status(404).send({ message: "Camp Not Found" })
            }

            res.send(findResult);
        });

        app.post("/participants", verifyToken, async (req, res) => {
            const participantData = req.body;
            const postResult = await participantCollection.insertOne(participantData);
            res.send(postResult);
        });

        app.patch("/confirmation-status/:id", verifyToken, verifyOrganizer, async (req, res) => {
            const participantId = req.params.id;
            const filter = { _id: new ObjectId(participantId) };

            const updateData = {
                $set: {
                    confirmationStatus: "Confirmed"
                }
            }

            const updateResult = await participantCollection.updateOne(filter, updateData);
            res.send(updateResult);
        });

        app.delete("/cancel-registration/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            const cancelResult = await participantCollection.deleteOne(query);
            res.send(cancelResult);
        });

        // Feedback collection
        app.get("/feedbacks", async (req, res) => {
            const feedbacksResult = await feedbackCollection.find().sort({ date: - 1 }).toArray();
            res.send(feedbacksResult);
        });

        app.post("/feedback-data", verifyToken, async (req, res) => {
            const feedback = req.body;
            const insertResult = await feedbackCollection.insertOne(feedback);
            res.send(insertResult);
        });

        // Ai related api
        app.get("/ai-images/:email", verifyToken, async (req, res) => {
            const userEmail = req.params.email;
            const query = { email: userEmail };
            const result = await imageCollection.find(query).toArray();
            res.send(result);
        });

        app.post("/generate", verifyToken, async (req, res) => {
            const generatedData = req.body;
            // console.log(generatedData);

            if (!generatedData) {
                res.status(400).send({ message: "An image generate before must get required information" })
                return;
            }

            try {
                // Insert data in MongoDB
                const result = await imageCollection.insertOne(generatedData);

                // Send response
                res.send(result);
            } catch (error) {
                // console.log(error);
                res.status(500).send(error);
            }
        });

        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get("/", async (req, res) => {
    res.send("Server of Popular Medical Camp is open");
});

app.listen(port, () => {
    console.log(`Popular Medical Camp server is running on ${port}`);
});