'use strict';

var nconf = require('nconf');
var Client = require('node-rest-client').Client;
var http = require('http');

var client = new Client();
var paypalToken = nconf.get('paypalConfig');

var paymentArgs ={
        path:{"bearer":"bearer"}, // path substitution var
        headers:{"Accept": "text/plain", "Accept-Language": "en_US", "Content-Type": "text/plain" }
};

// registering remote methods
client.registerMethod("authTokenMethod", "http://127.0.0.1:8080/jaxrs-sample/v1/paypal/auth", "GET");
client.registerMethod("paymentMethod", "http://127.0.0.1:8080/jaxrs-sample/v1/paypal/payment/${bearer}", "GET");

module.exports = function (app) {

    app.get('/payment-paypal', function (req, res) {

        console.log("Got Server Request: " + req);

        process_payment(function(data, response) {

            console.log("Processed Payment, Response=>" + data);

            if (data.state = "authorized") {
                //res.writeHead(200, {"Content-Type": "text/plain"});
                res.render('payment-paypal', {token: nconf.get('paypalConfig')});
            }
            else {
                res.writeHead(500, {"Content-Type": "text/plain"});
                res.end("Error Processing Payment: " + data.state);
            }
        });
    });
};

function process_payment(cb) {
  console.log("Called process_payment...");

  client.methods.authTokenMethod(function(data, response) {
     paymentArgs.path.bearer=data;

     console.log("Generated Auth Token: " + data);

     client.methods.paymentMethod(paymentArgs, function(data, response) {
        console.log("Processed Payment: " + data);
        cb(data, response);
     });
  });
};
