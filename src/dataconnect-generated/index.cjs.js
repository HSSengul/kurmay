const { queryRef, executeQuery, mutationRef, executeMutation, validateArgs } = require('firebase/data-connect');

const connectorConfig = {
  connector: 'example',
  service: 'kutukafa',
  location: 'europe-central2'
};
exports.connectorConfig = connectorConfig;

const createKutueRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateKutue', inputVars);
}
createKutueRef.operationName = 'CreateKutue';
exports.createKutueRef = createKutueRef;

exports.createKutue = function createKutue(dcOrVars, vars) {
  return executeMutation(createKutueRef(dcOrVars, vars));
};

const listKutuesByUserRef = (dc) => {
  const { dc: dcInstance} = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'ListKutuesByUser');
}
listKutuesByUserRef.operationName = 'ListKutuesByUser';
exports.listKutuesByUserRef = listKutuesByUserRef;

exports.listKutuesByUser = function listKutuesByUser(dc) {
  return executeQuery(listKutuesByUserRef(dc));
};

const likeKutueRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'LikeKutue', inputVars);
}
likeKutueRef.operationName = 'LikeKutue';
exports.likeKutueRef = likeKutueRef;

exports.likeKutue = function likeKutue(dcOrVars, vars) {
  return executeMutation(likeKutueRef(dcOrVars, vars));
};

const listKutuesRef = (dc) => {
  const { dc: dcInstance} = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'ListKutues');
}
listKutuesRef.operationName = 'ListKutues';
exports.listKutuesRef = listKutuesRef;

exports.listKutues = function listKutues(dc) {
  return executeQuery(listKutuesRef(dc));
};
