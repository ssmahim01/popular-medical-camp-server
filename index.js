require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');
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

        app.get("/users", async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
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