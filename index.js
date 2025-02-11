var util = require('gulp-util')
  , through = require('through2')
  , aws = require('aws-sdk');

module.exports = function (options) {
  options.wait = (options.wait === undefined || !options.wait) ? false : true;

  var cloudfront = new aws.CloudFront();

  cloudfront.config.update({
    accessKeyId: options.accessKeyId || process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: options.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: options.sessionToken || process.env.AWS_SESSION_TOKEN
  });

  var files = [];

  var complain = function (err, msg, callback) {
    throw new util.PluginError('gulp-cloudfront-invalidate', msg + ': ' + err);
    return callback(false);
  };

  var check = function (id, callback) {
    cloudfront.getInvalidation({
      DistributionId: options.distribution,
      Id: id
    }, function (err, res) {
      if (err) return complain(err, 'Could not check on invalidation', callback);

      if (res.Invalidation.Status === 'Completed') {
        return callback();
      } else {
        setTimeout(function () {
          check(id, callback);
        }, 1000);
      }
    })
  };

  var processFile = function (file, encoding, callback) {
    // https://github.com/pgherveou/gulp-awspublish/blob/master/lib/log-reporter.js
    var state;

    if (!file.s3) return callback(null, file);
    if (!file.s3.state) return callback(null, file);
    if (options.states &&
        options.states.indexOf(file.s3.state) === -1) return callback(null, file);

    switch (file.s3.state) {
      case 'update':
      case 'create':
      case 'delete':
        files.push(file.s3.path);
        break;
      case 'cache':
      case 'skip':
        break;
      default:
        util.log('Unknown state: ' + file.s3.state);
        break;
    }

    return callback(null, file);
  };

  function isHtmlFile(str) {
    var regex = /\.html(\.br)?(\.gz)?$/;
    var match = str.match(regex);

    return match !== null;
  }

  var invalidate = function(callback){
    if(files.length == 0) return callback();

    files = files.map(function(file) {
      if(isHtmlFile(file)) {
        return '/' + file;
      }
    }).filter(function(file) { return file });

    cloudfront.createInvalidation({
      DistributionId: options.distribution,
      InvalidationBatch: {
        CallerReference: Date.now().toString(),
        Paths: {
          Quantity: files.length,
          Items: files
        }
      }
    }, function (err, res) {
      if (err) return complain(err, 'Could not invalidate cloudfront', callback);

      util.log('Cloudfront invalidation created: ' + res.Invalidation.Id);

      if (!options.wait) {
        return callback();
      }

      check(res.Invalidation.Id, callback);
    });
  }

  return through.obj(processFile, invalidate);
};
