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
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded_email
            const query = { email }
            const user = await userCollection.findOne(query)

            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }

            next()
        }

        // verify Manager
        const verifyManager = async (req, res, next) => {
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
        app.get('/users', verifyFirebaseToken, verifyAdmin, async (req, res) => {
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
        app.patch('/users/:id/role', verifyFirebaseToken, verifyAdmin, async (req, res) => {
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


        app.patch('/users/:id/suspend', verifyFirebaseToken, verifyAdmin, async (req, res) => {
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
        app.delete('/users/:id', verifyFirebaseToken, verifyAdmin, async (req, res) => {
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
        app.post('/loans', verifyFirebaseToken, verifyManager, async (req, res) => {
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
        })

        // ?stats for dashboard

        // admin dashboard (for admin dashboard)
        app.get('/admin/dashboard-stats', verifyFirebaseToken, verifyAdmin, async (req, res) => {
            // Total users by role
            const usersByRole = await userCollection.aggregate([
                {
                    $group: {
                        _id: "$role",
                        count: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        role: "$_id",
                        count: 1,
                        _id: 0
                    }
                }
            ]).toArray();

            // find recent user
            const recentUsers = await userCollection
                .find({}, { projection: { email: 1, displayName: 1, role: 1 } })
                .sort({ createdAt: -1 })
                .limit(6)
                .toArray();

            // Total loans
            const totalLoans = await loansCollection.countDocuments();

            // Applications by status
            const applicationsByStatus = await applicationsCollection.aggregate([
                {
                    $group: {
                        _id: "$status",
                        count: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        status: "$_id",
                        count: 1,
                        _id: 0
                    }
                }
            ]).toArray();

            // Total application amount
            const totalApplicationAmount = await applicationsCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalAmount: { $sum: { $toDouble: "$loanAmount" } }
                    }
                }
            ]).toArray();

            // Approved application amount
            const approvedAmount = await applicationsCollection.aggregate([
                {
                    $match: { status: "approved" }
                },
                {
                    $group: {
                        _id: null,
                        totalApproved: { $sum: { $toDouble: "$loanAmount" } }
                    }
                }
            ]).toArray();

            // Recent applications
            const recentApplications = await applicationsCollection.aggregate([
                {
                    $sort: { createdAt: -1 }
                },
                {
                    $limit: 24
                },
                {
                    $project: {
                        firstName: 1,
                        lastName: 1,
                        loanId: 1,
                        loanTitle: 1,
                        email: 1,
                        loanAmount: 1,
                        status: 1,
                        createdAt: 1
                    }
                }
            ]).toArray();

            // top loand by monthly
            const topLoansOverTime = await applicationsCollection.aggregate([
                {
                    $addFields: {
                        createdAtDate: {
                            $cond: {
                                if: { $eq: [{ $type: "$createdAt" }, "string"] },
                                then: { $dateFromString: { dateString: "$createdAt" } },
                                else: "$createdAt"
                            }
                        }
                    }
                },
                {
                    $group: {
                        _id: "$loanTitle",
                        totalCount: { $sum: 1 }
                    }
                },
                {
                    $sort: { totalCount: -1 }
                },
                {
                    $limit: 5
                },
                {
                    $lookup: {
                        from: "applications",
                        let: { loanTitle: "$_id" },
                        pipeline: [
                            {
                                $addFields: {
                                    createdAtDate: {
                                        $cond: {
                                            if: { $eq: [{ $type: "$createdAt" }, "string"] },
                                            then: { $dateFromString: { dateString: "$createdAt" } },
                                            else: "$createdAt"
                                        }
                                    }
                                }
                            },
                            {
                                $match: {
                                    $expr: { $eq: ["$loanTitle", "$$loanTitle"] }
                                }
                            },
                            {
                                $group: {
                                    _id: {
                                        year: { $year: "$createdAtDate" },
                                        month: { $month: "$createdAtDate" }
                                    },
                                    count: { $sum: 1 }
                                }
                            },
                            {
                                $sort: { "_id.year": 1, "_id.month": 1 }
                            },
                            {
                                $project: {
                                    _id: 0,
                                    year: "$_id.year",
                                    month: "$_id.month",
                                    count: 1
                                }
                            }
                        ],
                        as: "trends"
                    }
                },
                {
                    $project: {
                        _id: 0,
                        loanTitle: "$_id",
                        totalApplications: "$totalCount",
                        trends: 1
                    }
                }
            ]).toArray()

            res.send({
                usersByRole,
                recentUsers,
                totalLoans,
                applicationsByStatus,
                totalApplicationAmount: totalApplicationAmount[0]?.totalAmount || 0,
                approvedAmount: approvedAmount[0]?.totalApproved || 0,
                recentApplications,
                topLoansOverTime
            })
        })


        // manager dashboard (for manager dashboard)

        app.get('/manager/dashboard-stats', verifyFirebaseToken,verifyManager, async (req, res) => {
            const managerEmail = req.decoded_email;

            const managerLoans = await loansCollection.find({
                $or: [
                    { managerEmail: managerEmail },
                    { email: managerEmail },
                    { createdBy: managerEmail }
                ]
            }).toArray();

            const totalLoans = managerLoans.length;
            const loanIds = managerLoans.map(loan => loan.loanId);

            // Count all applications for these loans
            const allApplicationsCount = await applicationsCollection.countDocuments({
                loanId: { $in: loanIds }
            })

            // Pending applications count
            const pendingApplications = await applicationsCollection.countDocuments({
                loanId: { $in: loanIds },
                status: "pending"
            });

            // Approved applications count
            const approvedApplications = await applicationsCollection.countDocuments({
                loanId: { $in: loanIds },
                status: "approved"
            });

            // Rejected applications count
            const rejectedApplications = await applicationsCollection.countDocuments({
                loanId: { $in: loanIds },
                status: "rejected"
            });

            // Total application amount for manager's loans
            const totalAmountResult = await applicationsCollection.aggregate([
                { $match: { loanId: { $in: loanIds } } },
                {
                    $group: {
                        _id: null,
                        total: { $sum: { $toDouble: "$loanAmount" } }
                    }
                }
            ]).toArray();

            const totalAmount = totalAmountResult[0]?.total || 0;

            // Applications by loan category
            const applicationsByCategory = await applicationsCollection.aggregate([
                { $match: { loanId: { $in: loanIds } } },
                {
                    $lookup: {
                        from: "loans",
                        localField: "loanId",
                        foreignField: "loanId",
                        as: "loanDetails"
                    }
                },
                { $unwind: { path: "$loanDetails", preserveNullAndEmptyArrays: true } },
                {
                    $group: {
                        _id: "$loanDetails.category",
                        count: { $sum: 1 },
                        totalAmount: { $sum: { $toDouble: "$loanAmount" } }
                    }
                },
                {
                    $project: {
                        category: { $ifNull: ["$_id", "Uncategorized"] },
                        count: 1,
                        totalAmount: 1,
                        _id: 0
                    }
                }
            ]).toArray();

            // Recent applications
            const recentApplications = await applicationsCollection.find({
                loanId: { $in: loanIds }
            })
                .sort({ createdAt: -1 })
                .limit(24)
                .project({
                    firstName: 1,
                    lastName: 1,
                    email: 1,
                    loanAmount: 1,
                    loanId: 1,
                    status: 1,
                    createdAt: 1,
                    loanTitle: 1
                })
                .toArray();

            // Recent loans
            const recentLoans = managerLoans
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, 7)
                .map(loan => ({
                    loanId: loan.loanId,
                    loanTitle: loan.loanTitle,
                    category: loan.category || 'Uncategorized',
                    interestRate: loan.interestRate || 0,
                    maxLoanLimit: loan.maxLoanLimit || 0,
                    showOnHome: loan.showOnHome || false,
                    createdAt: loan.createdAt
                }));

            // Monthly application trends (last 6 months)
            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

            const monthlyTrends = await applicationsCollection.aggregate([
                {
                    $match: {
                        loanId: { $in: loanIds },
                        createdAt: { $gte: sixMonthsAgo }
                    }
                },
                {
                    $group: {
                        _id: {
                            year: { $year: "$createdAt" },
                            month: { $month: "$createdAt" }
                        },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { "_id.year": 1, "_id.month": 1 } },
                {
                    $project: {
                        _id: 0,
                        year: "$_id.year",
                        month: "$_id.month",
                        count: 1
                    }
                }
            ]).toArray();

            // Top performing loans
            const topLoans = await applicationsCollection.aggregate([
                { $match: { loanId: { $in: loanIds } } },
                {
                    $group: {
                        _id: "$loanTitle",
                        applicationCount: { $sum: 1 },
                        totalAmount: { $sum: { $toDouble: "$loanAmount" } }
                    }
                },
                { $sort: { applicationCount: -1 } },
                { $limit: 10 },
                {
                    $project: {
                        loanTitle: "$_id",
                        applicationCount: 1,
                        totalAmount: 1,
                        _id: 0
                    }
                }
            ]).toArray();

            res.send({
                totalLoans,
                pendingApplications,
                approvedApplications,
                rejectedApplications,
                totalAmount,
                applicationsByCategory,
                recentApplications,
                recentLoans,
                monthlyTrends,
                topLoans
            })
        })

    }
    finally {

    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('FinBee is running')
})

module.exports = app;

// app.listen(port)
