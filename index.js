require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken'); 
const port = process.env.PORT || 5000;
const app = express();

app.use(express.json());
app.use(cors());

app.get("/", async(req, res) => {
    res.send("Server of Popular Medical Camp is open");
});

app.listen(port, () => {
    console.log(`Popular Medical Camp server is running on ${port}`);
});