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
