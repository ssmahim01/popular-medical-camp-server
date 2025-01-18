require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const port = process.env.PORT || 5000;
const app = express();

app.use(express.json());
app.use(cors());

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
        app.get("/users", verifyToken, verifyOrganizer, async (req, res) => {
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

        // Participant Analytics
        app.get("/analytics/:email", async(req, res) => {
            const userEmail = req.params.email;
            const findParticipantData = await participantCollection.find({participantEmail: userEmail}).toArray();

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

            let searchOption = {};
            if (search) {
                searchOption = { campName: { $regex: search, $options: "i" } }
            }

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

            const findCamps = campCollection.find(searchOption).sort(sortOption);
            const result = await findCamps.toArray();
            res.send(result);
        });

        app.get("/popular-camps", async (req, res) => {
            const sortCount = { participantCount: - 1 };

            const findCamps = campCollection.find({});
            const popularCamps = await findCamps.sort(sortCount).limit(6).toArray();
            res.send(popularCamps);
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

        app.post("/camps", verifyToken, verifyOrganizer, async (req, res) => {
            const campData = req.body;
            const insertResult = await campCollection.insertOne(campData);
            res.send(insertResult);
        });

        app.patch("/participant-count/:id", async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };

            const updateParticipantCount = {
                $inc: { participantCount: 1 }
            };

            const updateResult = await campCollection.updateOne(filter, updateParticipantCount);
            res.send(updateResult);
        });

        // Participants collection
        app.get("/registered-camps/:email", async(req, res) => {
            const email = req.params.email;
            const query = {participantEmail: email};

            const findRegisteredCamps = await participantCollection.find(query).toArray();
            res.send(findRegisteredCamps);
        });

        app.post("/participants", async (req, res) => {
            const participantData = req.body;
            const postResult = await participantCollection.insertOne(participantData);
            res.send(postResult);
        });

        app.delete("/cancel-registration/:id", async(req, res) => {
            const id = req.params.id;
            const query = {_id: new ObjectId(id)};

            const cancelResult = await participantCollection.deleteOne(query);
            res.send(cancelResult);
        });

        // Feedback collection
        app.post("/feedback-data", verifyToken, async(req, res) => {
            const feedback = req.body;
            const insertResult = await feedbackCollection.insertOne(feedback);
            res.send(insertResult);
        });

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
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