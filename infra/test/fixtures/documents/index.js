// Stands in for apps/api/dist/{create,list,delete}-document in infra tests, so they don't need a
// build. Never deployed.
exports.handler = async () => ({ statusCode: 200, body: '{}' });
