const express = require('express')
const cors = require('cors');
const app = express()
require('dotenv').config()
const { MongoClient, ServerApiVersion } = require('mongodb');

const port = process.env.PORT || 3000


// middlewere
app.use(express.json())
app.use(cors())


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



        // user related api


        //get users
        app.get('/users', async (req, res) => {
            const search = req.query.search
            const query = {}

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



        // create user
        app.post('/users', async (req, res) => {
            const user = req.body
            user.role = 'user';
            user.createdAt = new Date()
            const email = user.email

            const userExist = await userCollection.findOne({ email })
            if (userExist) {
                return res.send({ message: 'user exist' })
            }

            const result = await userCollection.insertOne(user)
            res.send(result)
        })




        // create loan for (user)
        app.post('/loans', async (req, res) => {
            const loan = req.body
            const loanId = generateLoanId()
            // Loan created time
            loan.createdAt = new Date()
            loan.loanId = loanId

            const result = await loansCollection.insertOne(loan)
            res.send(result)
        })



    }
    finally{

    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('Zap is shifting')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
