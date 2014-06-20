'use strict';



function StringMatcher(agent) {
  this.agent = agent;
}
exports.StringMatcher = StringMatcher;


StringMatcher.prototype.init = function() {
}


StringMatcher.prototype.matchString = function(matchCondition, input) {
	if(!input) {
		return false;
	}

	var match = false;

	if(matchCondition.matchStrings.length == 0) {
		if(matchCondition.type === 'IS_NOT_EMPTY' && input.length == 0) {
			match = true;
		}
	}
	else if(matchCondition.matchStrings.length == 1) {
		var matchString = matchCondition.matchStrings[0];

		if(!matchString || input.length < matchString.length) {
			return false;
		}

		switch(matchCondition.type) {
			case 'EQUALS':
				match = (matchString === input);
			 	break;
			case 'STARTS_WITH':
			  match = (input.substr(0, matchString.length) === matchString);
			 	break;
			case 'ENDS_WITH':
			  match = (input.substr(input.length - matchString.length, matchString.length) === matchString);
			 	break;
			case 'CONTAINS':
			  match = (input.indexOf(matchString) != -1)
			 	break;
			case 'MATCHES_REGEX':
			  if(!matchCondition._matchStringRegex && !matchCondition._matchStringRegexFailed) {
			  	try {
				  	matchCondition._matchStringRegex = new RexExp(matchString);
			  	}
			  	catch(err) {
			  		matchCondition._matchStringRegexFailed = true;
			  	}
			  }

			  if(!matchCondition._matchStringRegexFailed) {
				  match = !!matchCondition._matchStringRegex.exec(input);
			  }

			 	break;
		}
	}
	else if(matchCondition.matchStrings.length > 1) {
		match = false;

		if(matchCondition.type === 'IS_IN_LIST') {
			var matchStrings = matchCondition.matchStrings;
			if(matchStrings) {
				for(var i = 0; i < matchStrings.length; i++) {
					if(matchStrings[i] === input) {
						match = true;
						break;
					}
				}
			}
		} 
	}

	return match ^ matchCondition.isNot;
}