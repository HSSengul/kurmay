import { queryRef, executeQuery, mutationRef, executeMutation, validateArgs } from 'firebase/data-connect';

export const connectorConfig = {
  connector: 'example',
  service: 'kutukafa',
  location: 'europe-central2'
};

export const createKutueRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateKutue', inputVars);
}
createKutueRef.operationName = 'CreateKutue';

export function createKutue(dcOrVars, vars) {
  return executeMutation(createKutueRef(dcOrVars, vars));
}

export const listKutuesByUserRef = (dc) => {
  const { dc: dcInstance} = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'ListKutuesByUser');
}
listKutuesByUserRef.operationName = 'ListKutuesByUser';

export function listKutuesByUser(dc) {
  return executeQuery(listKutuesByUserRef(dc));
}

export const likeKutueRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'LikeKutue', inputVars);
}
likeKutueRef.operationName = 'LikeKutue';

export function likeKutue(dcOrVars, vars) {
  return executeMutation(likeKutueRef(dcOrVars, vars));
}

export const listKutuesRef = (dc) => {
  const { dc: dcInstance} = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'ListKutues');
}
listKutuesRef.operationName = 'ListKutues';

export function listKutues(dc) {
  return executeQuery(listKutuesRef(dc));
}

