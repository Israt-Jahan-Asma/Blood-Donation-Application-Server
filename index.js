const express = require('express')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors')
require('dotenv').config()
const app = express()
const port = process.env.PORT || 3000
const stripe = require('stripe')(process.env.STRIPE_SECRET)

// Middleware
app.use(cors());
app.use(express.json())

// Firebase Admin Setup
const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// Auth Middleware
const verfifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) {
        return res.status(401).send({ message: 'unauthorize access' })
    }
    try {
        const idToken = token.split(' ')[1]
        const decodedToken = await admin.auth().verifyIdToken(idToken)
        req.decoded_email = decodedToken.email
        next()
    } catch (error) {
        return res.status(401).send({ message: 'unauthorize access' })
    }
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster.v8ksg0w.mongodb.net/?appName=Cluster`;
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
        const database = client.db('missionscic11DB')
        const userCollection = database.collection('users')
        const requestsCollection = database.collection('requests')
        const paymentsCollection = database.collection('payments')

        // --- PUBLIC ROUTES ---
        app.get('/requests-public', async (req, res) => {
            const query = { status: 'pending' };
            const result = await requestsCollection.find(query).toArray();
            res.send(result);
        });

        app.get('/request-details/:id', async (req, res) => {
            const query = { _id: new ObjectId(req.params.id) };
            const result = await requestsCollection.findOne(query);
            if (!result) return res.status(404).send({ message: "Not found" });
            res.send(result);
        });

        app.get('/search', async (req, res) => {
            const { bloodGroup, district, upazila } = req.query;
            const query = {};
            if (bloodGroup) query.bloodGroup = bloodGroup;
            if (district) query.district = district;
            if (upazila) query.upazila = upazila;
            const result = await requestsCollection.find(query).toArray();
            res.send(result);
        });

        // --- USER ROUTES ---
        app.post('/users', async (req, res) => {
            const userInfo = req.body;
            const existingUser = await userCollection.findOne({ email: userInfo.email });
            if (existingUser) return res.send({ message: 'Exists', insertedId: null });

            userInfo.createdAt = new Date();
            userInfo.role = 'donor';
            userInfo.status = 'active';
            const result = await userCollection.insertOne(userInfo);
            res.send(result);
        });

        app.get('/users', verfifyFBToken, async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        });

        app.get('/users/role/:email', async (req, res) => {
            const result = await userCollection.findOne({ email: req.params.email });
            res.send(result);
        });

        app.patch('/update/user/status', verfifyFBToken, async (req, res) => {
            const { email, status } = req.query;
            const result = await userCollection.updateOne({ email }, { $set: { status } });
            res.send(result);
        });

        app.patch('/update/user/role', verfifyFBToken, async (req, res) => {
            const { email, role } = req.query;
            const result = await userCollection.updateOne({ email }, { $set: { role } });
            res.send(result);
        });

        app.patch('/users/update/:email', verfifyFBToken, async (req, res) => {
            const updatedData = req.body;
            delete updatedData.email;
            const result = await userCollection.updateOne({ email: req.params.email }, { $set: updatedData });
            res.send(result);
        });

        // --- DONATION REQUESTS ROUTES ---
        app.post('/requests', verfifyFBToken, async (req, res) => {
            const data = req.body;
            data.createdAt = new Date();
            const result = await requestsCollection.insertOne(data);
            res.send(result);
        });

        // Donor specific list
        
        app.get('/my-donation-requests', verfifyFBToken, async (req, res) => {
            const email = req.decoded_email;
            const size = Number(req.query.size) || 10;
            const page = Number(req.query.page) || 0;
            const status = req.query.status;
            const query = { requesterEmail: email };
            if (status && status !== '') {
                query.status = status;
            }

            const result = await requestsCollection.find(query)
                .sort({ createdAt: -1 })
                .limit(size)
                .skip(size * page)
                .toArray();

            const totalRequest = await requestsCollection.countDocuments(query);
            res.send({ request: result, totalRequest });
        });

        // Admin & Volunteer global list
        app.get('/all-donation-requests', verfifyFBToken, async (req, res) => {
            const user = await userCollection.findOne({ email: req.decoded_email });
            if (user?.role !== 'admin' && user?.role !== 'volunteer') {
                return res.status(403).send({ message: "Unauthorized access" });
            }
            const size = Number(req.query.size) || 10;
            const page = Number(req.query.page) || 0;
            const result = await requestsCollection.find().sort({ createdAt: -1 }).limit(size).skip(size * page).toArray();
            const totalRequest = await requestsCollection.countDocuments();
            res.send({ request: result, totalRequest });
        });

        app.get('/my-requests-recent', verfifyFBToken, async (req, res) => {
            const { role } = req.query;
            const query = role === 'donor' ? { requesterEmail: req.decoded_email } : {};
            const result = await requestsCollection.find(query).sort({ createdAt: -1 }).limit(3).toArray();
            res.send(result);
        });

        // Confirm request (Pending -> Inprogress)
        app.patch('/requests/confirm/:id', verfifyFBToken, async (req, res) => {
            const donorData = req.body;
            const updateDoc = { $set: { status: 'inprogress', donorName: donorData.name, donorEmail: donorData.email } };
            const result = await requestsCollection.updateOne({ _id: new ObjectId(req.params.id) }, updateDoc);
            res.send(result);
        });

        // Update status (Done/Canceled) - Allowed for Admin & Volunteer
        app.patch('/requests/status-update/:id', verfifyFBToken, async (req, res) => {
            const result = await requestsCollection.updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: { status: req.body.status } }
            );
            res.send(result);
        });

        // Restricted Edit - Volunteers cannot edit details
        app.put('/requests/update/:id', verfifyFBToken, async (req, res) => {
            const user = await userCollection.findOne({ email: req.decoded_email });
            if (user?.role === 'volunteer') {
                return res.status(403).send({ message: "Volunteers cannot edit request details" });
            }
            const result = await requestsCollection.updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: req.body }
            );
            res.send(result);
        });

        // Restricted Delete - Only Admin can delete
        app.delete('/requests/:id', verfifyFBToken, async (req, res) => {
            const user = await userCollection.findOne({ email: req.decoded_email });
            if (user?.role !== 'admin') {
                return res.status(403).send({ message: "Only Admins can delete requests" });
            }
            const result = await requestsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
            res.send(result);
        });

        // --- STATS & PAYMENTS ---
        app.get('/admin-stats', verfifyFBToken, async (req, res) => {
            const totalDonors = await userCollection.countDocuments({ role: 'donor' });
            const totalRequests = await requestsCollection.countDocuments();

            const fundingData = await paymentsCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalAmount: { $sum: "$amount" }
                    }
                }
            ]).toArray();

            res.send({ totalDonors, totalRequests, totalFunding: fundingData[0]?.totalAmount || 0 });
        });

        app.get('/funds', verfifyFBToken, async (req, res) => {
            try {
                const result = await paymentsCollection.find().sort({ paidAt: -1 }).toArray();
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to fetch funds" });
            }
        });

        app.post('/create-payment-checkout', async (req, res) => {
            const { donateAmount, donorEmail, donorName } = req.body;
            const amount = parseInt(donateAmount) * 100;
            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            unit_amount: amount,
                            product_data: { name: 'Blood Donation Fund' }
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                customer_email: donorEmail || undefined,
                metadata: {
                    donorName: donorName || "Anonymous"
                },
                success_url: `${process.env.SITE_DOMAIN}payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}payment-canceled`
            });
            res.send({ url: session.url });
        });

        app.post('/success-payment', async (req, res) => {
            const { session_id } = req.query;

            try {
                const session = await stripe.checkout.sessions.retrieve(session_id);

                if (session.payment_status === 'paid') {
                    const transactionId = session.payment_intent;

                    const isExist = await paymentsCollection.findOne({ transactionId });
                    if (isExist) return res.send({ message: "Already processed" });

                    const result = await paymentsCollection.insertOne({
                        amount: session.amount_total / 100,
                        donorEmail: session.customer_email,
                        donorName: session.metadata?.donorName || "Anonymous",
                        transactionId: transactionId,
                        paidAt: new Date()
                    });

                    res.send(result);
                } else {
                    res.status(400).send({ message: "Payment not completed" });
                }
            } catch (error) {
                res.status(500).send({ message: "Server error" });
            }
        });

        console.log("Connected to MongoDB!");
    } finally { }
}
run().catch(console.dir);

app.get('/', (req, res) => res.send('Mission SCIC Server Running'));
// app.listen(port, () => console.log(`Server on port ${port}`));
module.exports = app;