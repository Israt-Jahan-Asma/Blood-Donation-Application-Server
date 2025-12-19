const express = require('express')
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors')
require('dotenv').config()
const app = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

// firebase token 
const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')

const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// middleware
const verfifyFBToken = async (req, res, next)=>{
 const token = req.headers.authorization;
 if(!token){
     return res.status(401).send({ message: 'unauthorize access'})
 }
 try{
    const idToken = token.split(' ')[1]
    const decoded = await admin.auth().verifyIdToken(idToken)
    console.log('decoded info', decoded);
    req.decoded_email = decoded.email
    next()
    
 }
 catch(error){
     return res.status(401).send({ message: 'unauthorize access' })
 }
}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster.v8ksg0w.mongodb.net/?appName=Cluster`;

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
        await client.connect();
        // Send a ping to confirm a successful connection
        const database = client.db('missionscic11DB')
        const userCollection = database.collection('users')
        const requestsCollection = database.collection('requests')

        app.post('/users', async (req, res) => {
            const userInfo = req.body
            userInfo.createdAt = new Date()
            userInfo.role ='donor'
            userInfo.status = 'active'
            const result = await userCollection.insertOne(userInfo)
            res.send(result)
        })

        app.get('/users', verfifyFBToken, async (req, res)=>{
            const result = await userCollection.find().toArray()
            res.status(200).send(result)
        })
        app.get('/users/role/:email', async (req, res) => {
            const { email } = req.params
            const query = { email: email }
            const result = await userCollection.findOne(query)
            console.log(result);

            res.send(result)
        })

        app.patch('/update/user/status', verfifyFBToken, async(req, res)=>{
            const {email, status} = req.query
            const query = {email: email}

            const updateStatus = {
                $set: {
                    status: status
                }
            }
            const result = await userCollection.updateOne(query, updateStatus)
            res.send(result)
        })

        // create request 
        app.post('/requests', verfifyFBToken, async(req, res)=>{
            const data = req.body;
            data.createdAt = new Date()          
            const result = await requestsCollection.insertOne(data)
            res.send(result)
        })


        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Mission SCIC!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
