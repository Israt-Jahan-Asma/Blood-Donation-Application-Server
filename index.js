const express = require('express')
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors')
require('dotenv').config()
const app = express()
const port = process.env.PORT || 3000
const stripe = require('stripe')(process.env.STRIPE_SECRET)
const crypto = require('crypto')
app.use(cors())
app.use(express.json())

// firebase token

const admin = require("firebase-admin");
const { create } = require('domain');
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// middleware

const verfifyFBToken = async (req, res, next) => {

    const token = req.headers.authorization;
    if (!token) {
        return res.status(401).send({ message: 'unauthorize access' })
    }

    try {
        const idToken = token.split(' ')[1]
        const decoded = await admin.auth().verifyIdToken(idToken)
        console.log('decoded info', decoded);
        req.decoded_email = decoded.email
        next()

    }

    catch (error) {
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
        const paymentsCollection = database.collection ('payments')


        // 1. Get ALL PENDING requests for the public page
        app.get('/requests-public', async (req, res) => {
           
            const query = { status: 'pending' };
            const result = await requestsCollection.find(query).toArray();
            res.send(result);
        });

        // 2. Get SINGLE request details by ID
        
        const { ObjectId } = require('mongodb');

        app.get('/request-details/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await requestsCollection.findOne(query);
            if (!result) {
                return res.status(404).send({ message: "Request not found" });
            }
            res.send(result);
        });

        // 3. Update status from 'pending' to 'inprogress'
        app.patch('/requests/confirm/:id', verfifyFBToken, async (req, res) => {
            const id = req.params.id;
            const donorData = req.body; 
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    status: 'inprogress',
                    donorName: donorData.name,
                    donorEmail: donorData.email
                }
            };

            const result = await requestsCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        app.post('/users', async (req, res) => {

            const userInfo = req.body
            const query = { email: userInfo.email };
            const existingUser = await userCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'User already exists', insertedId: null });
            }

            userInfo.createdAt = new Date()
            userInfo.role = 'donor'
            userInfo.status = 'active'
            const result = await userCollection.insertOne(userInfo)
            res.send(result)

        })

        app.get('/users', verfifyFBToken, async (req, res) => {

            const result = await userCollection.find().toArray()
            res.status(200).send(result)
        })

        app.get('/users/role/:email', async (req, res) => {

            const { email } = req.params
            const query = { email: email }
            const result = await userCollection.findOne(query)
            res.send(result)

        })

        app.patch('/update/user/status', verfifyFBToken, async (req, res) => {

            const { email, status } = req.query;
            const query = { email: email }
            const updateStatus = {

                $set: {
                    status: status
                }
            }
            const result = await userCollection.updateOne(query, updateStatus)
            res.send(result)

        })
        // Update user role (Donor to Volunteer / Volunteer to Admin etc.)
        app.patch('/update/user/role', verfifyFBToken, async (req, res) => {
            const { email, role } = req.query;
            const query = { email: email };
            const updateRole = {
                $set: {
                    role: role
                }
            };
            const result = await userCollection.updateOne(query, updateRole);
            res.send(result);
        });

        app.get('/my-requests-recent', verfifyFBToken, async (req, res) => {
            const email = req.query.email;
            const { role } = req.query;

            let query = {};
            // If donor, only show their own. If admin/volunteer, show all.
            if (role === 'donor') {
                query = { requesterEmail: email };
            }

            const result = await requestsCollection.find(query) // Use the dynamic query here
                .sort({ createdAt: -1 })
                .limit(3)
                .toArray();
            res.send(result);
        });

        app.patch('/requests/status-update/:id', verfifyFBToken, async (req, res) => {
            const id = req.params.id;
            const status = req.body.status;
            const result = await requestsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status: status } }
            );
            res.send(result);
        });
        // Get a single request for editing
        app.get('/requests/edit/:id', verfifyFBToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await requestsCollection.findOne(query);
            res.send(result);
        });

        // Update the donation request
        app.put('/requests/update/:id', verfifyFBToken, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedRequest = req.body;
            const updateDoc = {
                $set: {
                    recipientName: updatedRequest.recipientName,
                    district: updatedRequest.district,
                    upazila: updatedRequest.upazila,
                    hospitalName: updatedRequest.hospitalName,
                    fullAddress: updatedRequest.fullAddress,
                    bloodGroup: updatedRequest.bloodGroup,
                    donationDate: updatedRequest.donationDate,
                    donationTime: updatedRequest.donationTime,
                    requestMessage: updatedRequest.requestMessage,
                },
            };
            const result = await requestsCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        app.delete('/requests/:id', verfifyFBToken, async (req, res) => {
            const result = await requestsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
            res.send(result);
        });

        // Update user profile information
        app.patch('/users/update/:email', verfifyFBToken, async (req, res) => {
            const email = req.params.email;
            const updatedData = req.body;
            delete updatedData.email;

            const filter = { email: email };
            const updateDoc = {
                $set: updatedData
            };

            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);
        });
        // create request

        app.post('/requests', verfifyFBToken, async (req, res) => {

            const data = req.body;
            data.createdAt = new Date()
            const result = await requestsCollection.insertOne(data)
            res.send(result)

        })
        app.get('/my-donation-requests', verfifyFBToken, async (req, res) => {

            const email = req.decoded_email;
            // const limit = Number(req.query.limit)
            // const skip = Number(req.query.skip)
            const size = Number(req.query.size)
            const page = Number(req.query.page)
            const query = { requesterEmail: email }
            const result = await requestsCollection.
                find(query)
                .limit(size)
                .skip(size * page)
                .toArray()

            const totalRequest = await requestsCollection.countDocuments(query)
            res.send({ request: result, totalRequest })

        })

        // Get ALL requests (for Admin/Volunteer)
        app.get('/all-donation-requests', verfifyFBToken, async (req, res) => {
            const size = Number(req.query.size) || 10;
            const page = Number(req.query.page) || 0;

            // Check if requester is Admin or Volunteer
            const userEmail = req.decoded_email;
            const user = await userCollection.findOne({ email: userEmail });

            if (user?.role !== 'admin' && user?.role !== 'volunteer') {
                return res.status(403).send({ message: "Unauthorized access" });
            }

            const result = await requestsCollection.find()
                .sort({ createdAt: -1 })
                .limit(size)
                .skip(size * page)
                .toArray();

            const totalRequest = await requestsCollection.countDocuments();
            res.send({ request: result, totalRequest });
        });

        app.get ('/search', async (req, res)=>{
            const {bloodGroup, district, upazila} = req.query
            const query = {}
            if(!query){
                return
            }
            if(bloodGroup){
                query.bloodGroup = bloodGroup
            }
            if(district){
                query.district = district;
            }
            if(upazila){
                query.upazila = upazila;
            }
            const result = await requestsCollection.find(query).toArray()
            console.log("Found matches:", result.length, result);
            res.send(result)

        })

        app.get('/admin-stats', verfifyFBToken, async (req, res) => {
            // 1. Count Total Donors
            const totalDonors = await userCollection.countDocuments({ role: 'donor' });

            // 2. Count Total Donation Requests
            const totalRequests = await requestsCollection.countDocuments();

            // 3. Calculate Total Funding (Sum of all payments)
            const fundingData = await paymentsCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalAmount: { $sum: "$amount" }
                    }
                }
            ]).toArray();

            const totalFunding = fundingData.length > 0 ? fundingData[0].totalAmount : 0;

            res.send({
                totalDonors,
                totalRequests,
                totalFunding
            });
        });

        //payments
        app.post('/create-payment-checkout', async (req, res) => {
            const information = req.body
            const amount = parseInt(information.donateAmount) * 100

            const session = await stripe.checkout.sessions.create({

                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            unit_amount: amount,
                            product_data:{
                                name: 'Please Donate'
                            }
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                metadata:{
                    donorName : information?.donorName
                },
                customer_email: information?.donorEmail,

                success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/payment-canceled`
            });
            res.send({url: session.url})

            })
        app.post('/success-payment', async (req, res) => {
            const {session_id} = req.query
            const session = await stripe.checkout.sessions.retrieve(
                session_id
              );
              console.log(session);
            const transactionId = session.payment_intent;

            const isPaymentExist = await paymentsCollection.findOne({transactionId})

            if (isPaymentExist){
                return
            }

            if (session.payment_status == 'paid')
            {
                const paymentInfo = {
                    amount: session.amount_total / 100,currency : session.currency,
                    donorEmail: session.customer_email,
                    transactionId,
                    payment_status: session.payment_status,
                    paidAt : new Date()
            }
                const result = await paymentsCollection.insertOne(paymentInfo)
                return res.send(result)
        }
           
            
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