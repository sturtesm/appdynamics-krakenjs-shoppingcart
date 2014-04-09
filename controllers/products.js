/**
 * A very simple product editor
 */
'use strict';

var Product = require('../models/productModel');

module.exports = function (server) {

    /**
     * Retrieve a list of all products for editing.
     */
    server.get('/products', function (req, res) {

        Product.find(function (err, prods) {
            if (err) {
                console.log(err);
            }

            var model =
            {
                products: prods
            };
            res.render('products', model);
        });

    });


    /**
     * Add a new product to the database.
     * **** PLEASE READ THE COMMENT BELOW! ****
     */
    server.post('/products', function (req, res) {
        var name = req.body.name && req.body.name.trim();

        //***** PLEASE READ THIS COMMENT ******\\\
        /*
         Using floating point numbers to represent currency is a *BAD* idea \\

         You should be using arbitrary precision libraries like:
         https://github.com/justmoon/node-bignum instead.

         So why am I not using it here? At the time of this writing, bignum is tricky to install
         on Windows-based systems. I opted to make this example accessible to more people, instead
         of making it mathematically correct.

         I would strongly advise against using this code in production.
         You've been warned!
         */
        var price = parseFloat(req.body.price, 10);

	console.log('Saving Price: ' + price);

        //Some very lightweight input checking
        if (name === '' || isNaN(price)) {
            res.redirect('/products#BadInput');
            return;
        }

        var newProduct = new Product({name: name, price: price});

        //Show it in console for educational purposes...
        newProduct.whatAmI();

        newProduct.save();

        res.redirect('/products');
    });

    /**
     * Delete a product.
     * @paaram: req.body.item_id Is the unique id of the product to remove.
     */
    server.delete('/products', function (req, res) {
        Product.remove({_id: req.body.item_id}, function (err) {
            if (err) {
                console.log('Remove error: ', err);
            }
            res.redirect('/products');
        });
    });


    /**
     * Edit a product.
     * Not implemented here
     */
    server.put('/products', function (req, res) {
        console.log('PUT received. Ignoring.');
        res.redirect('/products');
    });

};
