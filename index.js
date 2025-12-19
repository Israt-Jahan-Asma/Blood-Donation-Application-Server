const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
require('dotenv').config();
const admin = require("firebase-admin");

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Firebase Admin Setup
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decoded);
if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

// Global variables for collections
let userCollection, requestsCollection;

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster.v8ksg0w.mongodb.net/?appName=Cluster`;
const client = new MongoClient(uri, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});

// Middleware for token verification
const verfifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) return res.status(401).send({ message: 'unauthorize access' });
    try {
        const idToken = token.split(' ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.decoded_email = decodedToken.email;
        next();
    } catch (error) {
        return res.status(401).send({ message: 'unauthorize access' });
    }
};

async function run() {
    try {
        // Remove await client.connect() if using Vercel (MongoDB driver handles it)
        // await client.connect()
        const database = client.db('missionscic11DB');
        userCollection = database.collection('users');
        requestsCollection = database.collection('requests');
        console.log("Connected to MongoDB!");
    } catch (err) {
        console.error(err);
    }
}
run().catch(console.dir);

// --- ROUTES DEFINED OUTSIDE RUN() ---

app.get('/', (req, res) => res.send('Mission SCIC!'));

app.post('/users', async (req, res) => {
    const userInfo = req.body;
    userInfo.createdAt = new Date();
    userInfo.role = 'donor';
    userInfo.status = 'active';
    const result = await userCollection.insertOne(userInfo);
    res.send(result);
});

app.get('/users', verfifyFBToken, async (req, res) => {
    const result = await userCollection.find().toArray();
    res.status(200).send(result);
});

app.get('/users/role/:email', async (req, res) => {
    const { email } = req.params;
    const result = await userCollection.findOne({ email });
    res.send(result);
});

app.patch('/update/user/status', verfifyFBToken, async (req, res) => {
    const { email, status } = req.query;
    const result = await userCollection.updateOne({ email }, { $set: { status } });
    res.send(result);
});

app.get('/my-donation-requests', verfifyFBToken, async (req, res) => {
    const email = req.decoded_email;
    const size = Number(req.query.size) 
    const page = Number(req.query.page)
    const query = { requesterEmail: email };
    const result = await requestsCollection.find(query).limit(size).skip(size * page).toArray();
    const totalRequest = await requestsCollection.countDocuments(query);
    res.send({ request: result, totalRequest });
});

// For local development
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => console.log(`Server running on ${port}`));
}

// CRITICAL EXPORT
module.exports = app;