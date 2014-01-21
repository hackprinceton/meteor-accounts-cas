var Fiber = Npm.require('fibers');
var url = Npm.require('url');
var CAS = Npm.require('cas');

var _casCredentialTokens = {};

RoutePolicy.declare('/_cas/', 'network');

// Listen to incoming OAuth http requests
WebApp.connectHandlers.use(function(req, res, next) {
  // Need to create a Fiber since we're using synchronous http calls and nothing
  // else is wrapping this in a fiber automatically
  Fiber(function () {
  	middleware(req, res, next);
  }).run();
});

middleware = function (req, res, next) {
  // Make sure to catch any exceptions because otherwise we'd crash
  // the runner
  try {
  	var ticket = casTicket(req);
    if (!ticket) {
      // not a cas request.
      next();
      return;
    }

  	res.writeHead(200, {'Content-Type': 'text/html'});
  	var content = '<html><head><script>window.close()</script></head></html>';
  	res.end(content, 'utf-8');
  } catch (err) {
  }
};

var casTicket = function (req) {
  // req.url will be "/_cas/<token>?ticket=<ticket>"
  var barePath = req.url.substring(0, req.url.indexOf('?'));
  var splitPath = barePath.split('/');

  // Any non-cass request will continue down the default
  // middlewares.
  if (splitPath[1] !== '_cas')
    return null;

  // No token ?
  var credentialToken = splitPath[2];
  if (!credentialToken)
    return null;

  // get configuration
  if (!Meteor.settings.cas && !!Meteor.settings.cas.validate) {
        return null;
  }

  // get ticket and validate.
  var parsedUrl = url.parse(req.url, true);
  var ticketId = parsedUrl.query.ticket;

  var cas = new CAS({
  	base_url: Meteor.settings.cas.baseUrl,
  	service: Meteor.absoluteUrl() + "_cas/" + credentialToken
  });

  cas.validate(ticketId, function(err, status, username) {
      if (err) {
        console.log("accounts-cas: error when trying to validate "+err);
      } else {
      	if (status) {
      		console.log("accounts-cas: user validated "+username);
      		_casCredentialTokens[credentialToken] = { id: username };
      	} else {
      		console.log("accounts-cas: unable to validate "+ticketId);
      	}
      }
  });

  return ticketId; 
};

/*
 * Register a server-side login handle.
 * It is call after Accounts.callLoginMethod() is call from client.
 *
 */
Accounts.registerLoginHandler(function (options) {

	if (!options.cas)
		return undefined;

	if (!_hasCredential(options.cas.credentialToken)) {
		throw new Meteor.Error(Accounts.LoginCancelledError.numericError,
			'no matching login attempt found');
	}

	var result = _retrieveCredential(options.cas.credentialToken);

	var user = Accounts.updateOrCreateUserFromExternalService(
		"cas",
		result
	);

	// set username
    Meteor.users.update(
    	{ _id: user.id },
    	{ $set: { username: result.id}}
    );

	return user;
});

var _hasCredential = function(credentialToken) {
	return _.has(_casCredentialTokens, credentialToken);
}

/*
 * Retrieve token and delete it to avoid replaying it.
 */
var _retrieveCredential = function(credentialToken) {
	var result = _casCredentialTokens[credentialToken];
	delete _casCredentialTokens[credentialToken];
	return result;
}