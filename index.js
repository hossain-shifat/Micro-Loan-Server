const express = require('express')
const cors = require('cors');
const app = express()
require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')

const stripe = require('stripe')(process.env.STRIPE_API)

const port = process.env.PORT || 3000
const crypto = require('crypto');

function generateLoanId() {
    const prefix = 'LOAN';
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const random = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `${prefix}-${date}-${random}`;
}


const admin = require("firebase-admin");

// const serviceAccount = require("./micro-loan-firebase-adminsdk.json");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});



// middlewere
app.use(express.json())
app.use(cors())


// verify user with firebase token
const verifyFirebaseToken = async (req, res, next) => {

    const token = req.headers.authorization

    if (!token) {
        return res.status(401).send({ message: 'unauthorized access' })
    }

    try {
        const idToken = token.split(' ')[1]
        const decoded = await admin.auth().verifyIdToken(idToken)
        console.log("decoded in the token", decoded)
        req.decoded_email = decoded.email
    } catch (error) {
        return res.status(401).send({ message: 'unauthorized access' })
    }

    next()
}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.pbqwzvg.mongodb.net/?appName=Cluster0`;

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

        // collections
        const db = client.db('Micro_Loan')
        const userCollection = db.collection('users')
        const loansCollection = db.collection('loans')
        const applicationsCollection = db.collection('applications')
        const paymentCollection = db.collection('payments')



        // verify admin
        const veryfyAdmin = async (req, res, next) => {
            const email = req.decoded_email
            const query = { email }
            const user = await userCollection.findOne(query)

            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }

            next()
        }

        // verify Manager
        const veryfyManager = async (req, res, next) => {
            const email = req.decoded_email
            const query = { email }
            const user = await userCollection.findOne(query)

            if (!user || user.role !== 'manager') {
                return res.status(403).send({ message: 'forbidden access' })
            }

            next()
        }

        // verify admin and manager both
        const verifyAdminOrManager = async (req, res, next) => {
            const email = req.decoded_email;
            const user = await userCollection.findOne({ email });

            if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
                return res.status(403).send({ message: 'forbidden access' });
            }

            next();
        };




        // user related api


        //get users
        app.get('/users', verifyFirebaseToken, veryfyAdmin, async (req, res) => {
            const search = req.query.search
            const query = {}

            if (search) {
                query.$or = [
                    { displayName: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } }
                ]
            }

            const cursor = userCollection.find(query).sort({ createdAt: -1 })
            const result = await cursor.toArray()
            res.send(result)
        })

        //get users by email/role
        app.get('/users/:email/role', async (req, res) => {
            const email = req.params.email
            const query = { email }
            const user = await userCollection.findOne(query)
            res.send({ role: user?.role || 'user' })
        })


        // patch user (for user managment)
        app.patch('/users/:id/role', verifyFirebaseToken, veryfyAdmin, async (req, res) => {
            const id = req.params.id
            const roleInfo = req.body
            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: roleInfo.role
                }
            }
            const result = await userCollection.updateOne(query, updateDoc)
            res.send(result)
        })


        app.patch('/users/:id/suspend', verifyFirebaseToken, veryfyAdmin, async (req, res) => {
            const id = req.params.id;
            const { reason, feedback } = req.body;

            const query = { _id: new ObjectId(id) };

            const updateDoc = {
                $set: {
                    role: "suspended",
                    reason: reason,
                    feedback: feedback
                }
            };

            const result = await userCollection.updateOne(query, updateDoc);

            res.send(result);
        });


        // for update profile
        app.patch('/users/profile', verifyFirebaseToken, async (req, res) => {
            const email = req.decoded.email
            const { displayName, photoURL } = req.body

            const query = { email: email }

            const updateDoc = {
                $set: {
                    displayName,
                    photoURL
                }
            };

            const result = await userCollection.updateOne(query, updateDoc);
            res.send(result);
        });


        // create user
        app.post('/users', async (req, res) => {
            const user = req.body
            user.role = user.applyFor
            user.createdAt = new Date()
            const email = user.email

            const userExist = await userCollection.findOne({ email })
            if (userExist) {
                return res.send({ message: 'user exist' })
            }

            const result = await userCollection.insertOne(user)
            res.send(result)
        })

        // delete api (for user managment)
        app.delete('/users/:id', verifyFirebaseToken, veryfyAdmin, async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await userCollection.deleteOne(query)
            res.send(result)
        })


        //? loan application apis (for users borrowers)

        // get all application (using email)
        app.get('/applications', async (req, res) => {
            const query = {}

            const { email, status } = req.query

            if (email) {
                query.email = email
            }
            if (status) {
                query.status = status
            }

            const options = { sort: { createdAt: -1 } }

            const cursor = applicationsCollection.find(query, options)
            const result = await cursor.toArray()
            res.send(result)
        })


        // post for application
        app.post('/applications', verifyFirebaseToken, async (req, res) => {
            const application = req.body

            application.status = 'pending'
            application.applicationFeeStatus = 'unpaid'
            application.createdAt = new Date()

            const result = await applicationsCollection.insertOne(application)
            res.send(result)
        })

        // application patch for (manager)
        app.patch('/applications/:id/status', verifyFirebaseToken, async (req, res) => {
            const id = req.params.id
            const { status } = req.body

            const query = { _id: new ObjectId(id) }

            const updateDoc = {
                $set: {
                    status: status,
                    statusUpdatedAt: new Date()
                }
            }

            const result = await applicationsCollection.updateOne(query, updateDoc)
            res.send(result);
        });

        // add delete api (for approved applications)
        app.delete('/applications/:id', verifyFirebaseToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await applicationsCollection.deleteOne(query);
            res.send(result)
        });



        //?loans apis (for managers and andmins)

        // get all loans (for all loan page(users) and admin)
        app.get('/loans', async (req, res) => {
            const query = {}
            const options = { sort: { createdAt: -1 } }

            const cursor = loansCollection.find(query, options)
            const result = await cursor.toArray()
            res.send(result)
        })


        //get loans by email (for manager manage loans)
        app.get('/loans', async (req, res) => {
            const email = req.query.email;
            let query = {}

            if (email) {
                query.email = email
            }
            const options = { sort: { createdAt: -1 } }
            const result = await loansCollection.find(query, options).toArray()
            res.send(result)
        })


        // get loans for home route
        app.get('/home-loans', async (req, res) => {
            const cursor = loansCollection.find({}).sort({ createdAt: -1 }).limit(6);
            const result = await cursor.toArray();
            res.send(result);
        })

        app.get('/home-loans/featured', async (req, res) => {
            const featuredLoans = await loansCollection.find({ showOnHome: true }).sort({ createdAt: -1 }).toArray();
            res.send(featuredLoans);
        });

        // create loan (manager)
        app.post('/loans', verifyFirebaseToken, veryfyManager, async (req, res) => {
            const loan = req.body

            // Loan created time
            loan.createdAt = new Date()
            loan.loanId = generateLoanId()

            const result = await loansCollection.insertOne(loan)
            res.send(result)
        })

        // patch loan (for update modal in manage loan (manager & admin))
        app.patch('/loans/:id', verifyFirebaseToken, verifyAdminOrManager, async (req, res) => {

            const id = req.params.id;
            const updateData = req.body;

            const query = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: updateData
            }
            const result = await loansCollection.updateOne(query, updateDoc);

            res.send(result);
        })


        // delete loan (for manage loans)
        app.delete('/loans/:id', verifyFirebaseToken, verifyAdminOrManager, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            const result = await loansCollection.deleteOne(query);

            res.send(result);
        })


        //?payment related apis

        // payment checkout session
        app.post('/payment-checkout-session', async (req, res) => {
            const paymentInfo = req.body;
            const amount = 10 * 100

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'USD',
                            unit_amount: amount,
                            product_data: {
                                name: `Loan Application Fee for ${paymentInfo.loanTitle}`
                            }
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                metadata: {
                    applicationId: paymentInfo.applicationId,
                    loanId: paymentInfo.loanId,
                    loanTitle: paymentInfo.loanTitle,
                    borrowerName: `${paymentInfo.firstName} ${paymentInfo.lastName}`,
                    borrowerEmail: paymentInfo.email,
                    borrowerPhone: paymentInfo.contactNumber
                },
                customer_email: paymentInfo.email,
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel`,
            });

            res.send({ url: session.url });
        })

        // payment success
        app.patch('/payment-success', async (req, res) => {
            const sessionId = req.query.session_id;
            const session = await stripe.checkout.sessions.retrieve(sessionId);

            console.log('Stripe session retrieved:', session);

            const transactionId = session.payment_intent;


            const paymentExist = await paymentCollection.findOne({ transactionId });

            if (paymentExist) {
                return res.send({
                    message: 'already exist',
                    transactionId,
                    loanId: paymentExist.loanId,
                    amount: paymentExist.amount,
                    customerEmail: paymentExist.customerEmail,
                    paidAt: paymentExist.paidAt
                });
            }

            if (session.payment_status === 'paid') {
                const applicationId = session.metadata.applicationId;
                const loanId = session.metadata.loanId;

                const query = { _id: new ObjectId(applicationId) };
                const update = {
                    $set: {
                        paymentStatus: 'paid',
                        transactionId: transactionId
                    }
                };
                const result = await applicationsCollection.updateOne(query, update);

                const payment = {
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    customerEmail: session.customer_email,
                    loanId: loanId,
                    loanTitle: session.metadata.loanTitle,
                    borrowerName: session.metadata.borrowerName,
                    borrowerPhone: session.metadata.borrowerPhone,
                    applicationId: applicationId,
                    transactionId: transactionId,
                    paymentStatus: session.payment_status,
                    paidAt: new Date()
                };

                const resultPayment = await paymentCollection.insertOne(payment);

                return res.send({
                    success: true,
                    modifyApplication: result,
                    transactionId,
                    amount: session.amount_total / 100,
                    customerEmail: session.customer_email,
                    paidAt: new Date(),
                    paymentInfo: resultPayment
                });
            }

            res.send({ success: false });
        })

        // payment details (for transaction history)
        app.get('/payments', verifyFirebaseToken, async (req, res) => {
            const email = req.query.email;
            const query = {};

            if (email) {
                query.customerEmail = email;
                if (email !== req.decoded_email) {
                    return res.status(403).send({ message: 'forbidden access' });
                }
            }
            const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
            const result = await cursor.toArray();

            res.send(result);
        });



    }
    finally {

    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('FinBee is running')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
