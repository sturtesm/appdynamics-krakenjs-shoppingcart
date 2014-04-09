'use strict';

var mongoose = require('mongoose');

var productModel = function () {

    //Define a super simple schema for our products.
    var productSchema = mongoose.Schema({
        name: String,
        price: Number
    });

    /**
     * Verbose toString method
     */
    productSchema.methods.whatAmI = function () {
        var greeting = this.name ?
            'Hello, I\'m a ' + this.name + ' and I\'m worth $' + this.price
            : 'I don\'t have a name :(';
        console.log(greeting);
    };

    /**
     * Format the price of the product to show a dollar sign, and two decimal places
     */
    productSchema.methods.prettyPrice = function () {

	if (this != undefined && this.price != undefined) {
	  return '$' + this.price.toFixed(2);
	}
	else {
	  return '$0.00';
 	}
    };

    return mongoose.model('Product', productSchema);

};

module.exports = new productModel();
