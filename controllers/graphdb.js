'use strict';


var GraphdbModel = require('../models/graphdb');


module.exports = function (app) {

    var model = new GraphdbModel();


    app.get('/graphdb', function (req, res) {
        
        res.render('graphdb', model);
        
    });

};
