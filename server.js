// Imports and constants
const express = require('express');
const exphbs = require('express-handlebars');
const cloudinary = require('cloudinary').v2;
const bodyParser = require('body-parser');
const fs = require('fs');
const MongoClient = require('mongodb').MongoClient;
const app = express();
const fetch = require('node-fetch');
const opencage = require('opencage-api-client');
const fileUpload = require('express-fileupload');
const portnumber = process.env.PORT || 3000;
const dbSecret = JSON.parse(fs.readFileSync('./javascript/dbsecrets.json'));
const url = "mongodb+srv://catspotteam:" + dbSecret.key + "@cat-spot-vx3kz.mongodb.net/test?retryWrites=true&w=majority";
const db;

cloudinary.config({ 
    cloud_name: 'dlacs8amd', 
    api_key: dbSecret.id, 
    api_secret: dbSecret.secret 
  });

app.engine('handlebars', exphbs());
app.set('view engine', 'handlebars');

function findAddress(data) {
    if (data.status.code == 200) {
        if (data.results.length > 0) {
            var place = data.results[0];
            console.log(place);

            // Prioritize the name of the building,
            if (place.components.building){
                return place.components.building;
            }
            // then the name of the road,
            if (place.components.road){
                return place.components.road;
            }
            // and lastly if neither exist just return the lat/long as a formatted string
            return "Lat: " + place.annotations.DMS.lat + ", Long: " + place.annotations.DMS.lng;
        }
    } else if (data.status.code == 402) {
        console.log('hit free-trial daily limit');
    } else {
        console.log('error', data.status.message);
    }
    return null;
}

async function main() {
    const database = await MongoClient.connect(url);

    // Store the database object so that we can interact with it and get data from it
    db = database.db('cat-spot');
    db.collection('cat-spottings').createIndex({ createdAt: 1 });

    // Start the server
    app.listen(portnumber, function() {
        console.log("Server running on port " + portnumber);
    });

    // Tell the server where the css and javascript are located
    app.use('/css', express.static(__dirname + '/css'));
    app.use('/images', express.static(__dirname + '/images'));
    app.use('/javascript', express.static(__dirname + '/javascript'));
    app.use('/sdk', express.static(__dirname + '/sdk'));
    app.use(express.json());
    app.use(fileUpload());

    // GET / - gets index.html
    app.get('/', async function(req, res){

        // This gets cats that were spotted in the last 24 hours
        // this array contains cats in the form of [ {_id: 1, name: "cat name", lat: 123, long: 145, createdAt: date}, ... ]
        let cats = await db.collection('cat-spottings')
            .find({"createdAt":{$gt:new Date(Date.now() - 24*60*60 * 1000)}})
            .toArray();

        res.status(200).render('map',{
          layout: false,
          post: cats.reverse()
        });

        //res.status(200).sendFile(__dirname + "/index.html");
        // Eventually, when we use views, we can call res.render('indexView', { 'catarray' : cats });
        // so that we can pass the backend cats to the front end
    });

    // GET /cat-locations - gets all cats from the database as a list
    // This is a helper function to script.js that allows the map to load all cat spottings as markers
    app.get('/cat-locations', async function(req, res) {

        // This gets cats that were spotted in the last 24 hours
        // this array contains cats in the form of [ {_id: 1, name: "cat name", lat: 123, long: 145, createdAt: date}, ... ]
        let cats = await db.collection('cat-spottings')
            .find({"createdAt":{$gt:new Date(Date.now() - 24*60*60 * 1000)}}).toArray();
        res.status(200).send(cats);
    });

    // POST /cat-spotting - uploads a new cat to the database
    // example POST:
    // { "lat" : 44.5242, "long" : -123.2792, "color" : "white", ...etc }
    app.post('/cat-spotting', async function(req, res){
        // Put the picture of the cat uploaded in the images folder on the server
        let randomFileName = Math.floor(Math.random()*10000000).toString();
        req.files.catImage.mv('./images/' + randomFileName + '.jpg');

        // Now, upload it to the cloud provider for easier access
        const result = await cloudinary.uploader.upload("./images/" + randomFileName + ".jpg", 
            { use_filename : true });

        // Grab the data object from the geocode api with information about the location
        const data = await opencage.geocode({q: req.body.lat + ', ' + req.body.long, language: 'en'});

        console.log(req.body.lat + " " + req.body.long);

        // If the lat/long are valid, take nearest address, else "it's a mystery"
        const addr = (req.body.lat && req.body.long) ? findAddress(data) : "It's a mystery";

        // Parse the request, and use the body's values to create a new entry in the database
        db.collection('cat-spottings').insertOne(
            {
                "lat" : req.body.lat,
                "long" : req.body.long,
                "color" : req.body.color,
                "energy" : req.body.energy,
                "sociability" : req.body.sociability,
                "imageName" : randomFileName + '.jpg',
                "address" : addr,
                "url" : result.url,
                "createdAt" : new Date() //the date the POST is made is added automatically
            }
        );

        console.log("Saved " + req.body.color + " cat at lat: " + 
            req.body.lat + ", long: " + req.body.long + " with energy: " + req.body.energy + 
            " and sociability: " + req.body.sociability + " and address: " + addr + 
            ".\nUrl: " + result.url + " to the db!");
        
        // When a POST request is made, the main page (index.html) is reloaded so that the newest cat will
        // show up in both the map and the timeline.
        res.redirect('/');

    });
}

main();
