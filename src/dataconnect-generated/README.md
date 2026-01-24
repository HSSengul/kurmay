# Generated TypeScript README
This README will guide you through the process of using the generated JavaScript SDK package for the connector `example`. It will also provide examples on how to use your generated SDK to call your Data Connect queries and mutations.

**If you're looking for the `React README`, you can find it at [`dataconnect-generated/react/README.md`](./react/README.md)**

***NOTE:** This README is generated alongside the generated SDK. If you make changes to this file, they will be overwritten when the SDK is regenerated.*

# Table of Contents
- [**Overview**](#generated-javascript-readme)
- [**Accessing the connector**](#accessing-the-connector)
  - [*Connecting to the local Emulator*](#connecting-to-the-local-emulator)
- [**Queries**](#queries)
  - [*ListKutuesByUser*](#listkutuesbyuser)
  - [*ListKutues*](#listkutues)
- [**Mutations**](#mutations)
  - [*CreateKutue*](#createkutue)
  - [*LikeKutue*](#likekutue)

# Accessing the connector
A connector is a collection of Queries and Mutations. One SDK is generated for each connector - this SDK is generated for the connector `example`. You can find more information about connectors in the [Data Connect documentation](https://firebase.google.com/docs/data-connect#how-does).

You can use this generated SDK by importing from the package `@dataconnect/generated` as shown below. Both CommonJS and ESM imports are supported.

You can also follow the instructions from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#set-client).

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig } from '@dataconnect/generated';

const dataConnect = getDataConnect(connectorConfig);
```

## Connecting to the local Emulator
By default, the connector will connect to the production service.

To connect to the emulator, you can use the following code.
You can also follow the emulator instructions from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#instrument-clients).

```typescript
import { connectDataConnectEmulator, getDataConnect } from 'firebase/data-connect';
import { connectorConfig } from '@dataconnect/generated';

const dataConnect = getDataConnect(connectorConfig);
connectDataConnectEmulator(dataConnect, 'localhost', 9399);
```

After it's initialized, you can call your Data Connect [queries](#queries) and [mutations](#mutations) from your generated SDK.

# Queries

There are two ways to execute a Data Connect Query using the generated Web SDK:
- Using a Query Reference function, which returns a `QueryRef`
  - The `QueryRef` can be used as an argument to `executeQuery()`, which will execute the Query and return a `QueryPromise`
- Using an action shortcut function, which returns a `QueryPromise`
  - Calling the action shortcut function will execute the Query and return a `QueryPromise`

The following is true for both the action shortcut function and the `QueryRef` function:
- The `QueryPromise` returned will resolve to the result of the Query once it has finished executing
- If the Query accepts arguments, both the action shortcut function and the `QueryRef` function accept a single argument: an object that contains all the required variables (and the optional variables) for the Query
- Both functions can be called with or without passing in a `DataConnect` instance as an argument. If no `DataConnect` argument is passed in, then the generated SDK will call `getDataConnect(connectorConfig)` behind the scenes for you.

Below are examples of how to use the `example` connector's generated functions to execute each query. You can also follow the examples from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#using-queries).

## ListKutuesByUser
You can execute the `ListKutuesByUser` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
listKutuesByUser(): QueryPromise<ListKutuesByUserData, undefined>;

interface ListKutuesByUserRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListKutuesByUserData, undefined>;
}
export const listKutuesByUserRef: ListKutuesByUserRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
listKutuesByUser(dc: DataConnect): QueryPromise<ListKutuesByUserData, undefined>;

interface ListKutuesByUserRef {
  ...
  (dc: DataConnect): QueryRef<ListKutuesByUserData, undefined>;
}
export const listKutuesByUserRef: ListKutuesByUserRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the listKutuesByUserRef:
```typescript
const name = listKutuesByUserRef.operationName;
console.log(name);
```

### Variables
The `ListKutuesByUser` query has no variables.
### Return Type
Recall that executing the `ListKutuesByUser` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `ListKutuesByUserData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface ListKutuesByUserData {
  kutues: ({
    id: UUIDString;
    content: string;
    imageUrl?: string | null;
    createdAt: TimestampString;
  } & Kutue_Key)[];
}
```
### Using `ListKutuesByUser`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, listKutuesByUser } from '@dataconnect/generated';


// Call the `listKutuesByUser()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await listKutuesByUser();

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await listKutuesByUser(dataConnect);

console.log(data.kutues);

// Or, you can use the `Promise` API.
listKutuesByUser().then((response) => {
  const data = response.data;
  console.log(data.kutues);
});
```

### Using `ListKutuesByUser`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, listKutuesByUserRef } from '@dataconnect/generated';


// Call the `listKutuesByUserRef()` function to get a reference to the query.
const ref = listKutuesByUserRef();

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = listKutuesByUserRef(dataConnect);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.kutues);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.kutues);
});
```

## ListKutues
You can execute the `ListKutues` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
listKutues(): QueryPromise<ListKutuesData, undefined>;

interface ListKutuesRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListKutuesData, undefined>;
}
export const listKutuesRef: ListKutuesRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
listKutues(dc: DataConnect): QueryPromise<ListKutuesData, undefined>;

interface ListKutuesRef {
  ...
  (dc: DataConnect): QueryRef<ListKutuesData, undefined>;
}
export const listKutuesRef: ListKutuesRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the listKutuesRef:
```typescript
const name = listKutuesRef.operationName;
console.log(name);
```

### Variables
The `ListKutues` query has no variables.
### Return Type
Recall that executing the `ListKutues` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `ListKutuesData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface ListKutuesData {
  kutues: ({
    id: UUIDString;
    content: string;
    imageUrl?: string | null;
    createdAt: TimestampString;
    user?: {
      id: UUIDString;
      username: string;
      profilePictureUrl?: string | null;
    } & User_Key;
      _count: number;
  } & Kutue_Key)[];
}
```
### Using `ListKutues`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, listKutues } from '@dataconnect/generated';


// Call the `listKutues()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await listKutues();

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await listKutues(dataConnect);

console.log(data.kutues);

// Or, you can use the `Promise` API.
listKutues().then((response) => {
  const data = response.data;
  console.log(data.kutues);
});
```

### Using `ListKutues`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, listKutuesRef } from '@dataconnect/generated';


// Call the `listKutuesRef()` function to get a reference to the query.
const ref = listKutuesRef();

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = listKutuesRef(dataConnect);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.kutues);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.kutues);
});
```

# Mutations

There are two ways to execute a Data Connect Mutation using the generated Web SDK:
- Using a Mutation Reference function, which returns a `MutationRef`
  - The `MutationRef` can be used as an argument to `executeMutation()`, which will execute the Mutation and return a `MutationPromise`
- Using an action shortcut function, which returns a `MutationPromise`
  - Calling the action shortcut function will execute the Mutation and return a `MutationPromise`

The following is true for both the action shortcut function and the `MutationRef` function:
- The `MutationPromise` returned will resolve to the result of the Mutation once it has finished executing
- If the Mutation accepts arguments, both the action shortcut function and the `MutationRef` function accept a single argument: an object that contains all the required variables (and the optional variables) for the Mutation
- Both functions can be called with or without passing in a `DataConnect` instance as an argument. If no `DataConnect` argument is passed in, then the generated SDK will call `getDataConnect(connectorConfig)` behind the scenes for you.

Below are examples of how to use the `example` connector's generated functions to execute each mutation. You can also follow the examples from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#using-mutations).

## CreateKutue
You can execute the `CreateKutue` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
createKutue(vars: CreateKutueVariables): MutationPromise<CreateKutueData, CreateKutueVariables>;

interface CreateKutueRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateKutueVariables): MutationRef<CreateKutueData, CreateKutueVariables>;
}
export const createKutueRef: CreateKutueRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
createKutue(dc: DataConnect, vars: CreateKutueVariables): MutationPromise<CreateKutueData, CreateKutueVariables>;

interface CreateKutueRef {
  ...
  (dc: DataConnect, vars: CreateKutueVariables): MutationRef<CreateKutueData, CreateKutueVariables>;
}
export const createKutueRef: CreateKutueRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the createKutueRef:
```typescript
const name = createKutueRef.operationName;
console.log(name);
```

### Variables
The `CreateKutue` mutation requires an argument of type `CreateKutueVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CreateKutueVariables {
  content: string;
  imageUrl?: string | null;
}
```
### Return Type
Recall that executing the `CreateKutue` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CreateKutueData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CreateKutueData {
  kutue_insert: Kutue_Key;
}
```
### Using `CreateKutue`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, createKutue, CreateKutueVariables } from '@dataconnect/generated';

// The `CreateKutue` mutation requires an argument of type `CreateKutueVariables`:
const createKutueVars: CreateKutueVariables = {
  content: ..., 
  imageUrl: ..., // optional
};

// Call the `createKutue()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await createKutue(createKutueVars);
// Variables can be defined inline as well.
const { data } = await createKutue({ content: ..., imageUrl: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await createKutue(dataConnect, createKutueVars);

console.log(data.kutue_insert);

// Or, you can use the `Promise` API.
createKutue(createKutueVars).then((response) => {
  const data = response.data;
  console.log(data.kutue_insert);
});
```

### Using `CreateKutue`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, createKutueRef, CreateKutueVariables } from '@dataconnect/generated';

// The `CreateKutue` mutation requires an argument of type `CreateKutueVariables`:
const createKutueVars: CreateKutueVariables = {
  content: ..., 
  imageUrl: ..., // optional
};

// Call the `createKutueRef()` function to get a reference to the mutation.
const ref = createKutueRef(createKutueVars);
// Variables can be defined inline as well.
const ref = createKutueRef({ content: ..., imageUrl: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = createKutueRef(dataConnect, createKutueVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.kutue_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.kutue_insert);
});
```

## LikeKutue
You can execute the `LikeKutue` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
likeKutue(vars: LikeKutueVariables): MutationPromise<LikeKutueData, LikeKutueVariables>;

interface LikeKutueRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: LikeKutueVariables): MutationRef<LikeKutueData, LikeKutueVariables>;
}
export const likeKutueRef: LikeKutueRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
likeKutue(dc: DataConnect, vars: LikeKutueVariables): MutationPromise<LikeKutueData, LikeKutueVariables>;

interface LikeKutueRef {
  ...
  (dc: DataConnect, vars: LikeKutueVariables): MutationRef<LikeKutueData, LikeKutueVariables>;
}
export const likeKutueRef: LikeKutueRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the likeKutueRef:
```typescript
const name = likeKutueRef.operationName;
console.log(name);
```

### Variables
The `LikeKutue` mutation requires an argument of type `LikeKutueVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface LikeKutueVariables {
  kutueId: UUIDString;
}
```
### Return Type
Recall that executing the `LikeKutue` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `LikeKutueData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface LikeKutueData {
  like_insert: Like_Key;
}
```
### Using `LikeKutue`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, likeKutue, LikeKutueVariables } from '@dataconnect/generated';

// The `LikeKutue` mutation requires an argument of type `LikeKutueVariables`:
const likeKutueVars: LikeKutueVariables = {
  kutueId: ..., 
};

// Call the `likeKutue()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await likeKutue(likeKutueVars);
// Variables can be defined inline as well.
const { data } = await likeKutue({ kutueId: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await likeKutue(dataConnect, likeKutueVars);

console.log(data.like_insert);

// Or, you can use the `Promise` API.
likeKutue(likeKutueVars).then((response) => {
  const data = response.data;
  console.log(data.like_insert);
});
```

### Using `LikeKutue`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, likeKutueRef, LikeKutueVariables } from '@dataconnect/generated';

// The `LikeKutue` mutation requires an argument of type `LikeKutueVariables`:
const likeKutueVars: LikeKutueVariables = {
  kutueId: ..., 
};

// Call the `likeKutueRef()` function to get a reference to the mutation.
const ref = likeKutueRef(likeKutueVars);
// Variables can be defined inline as well.
const ref = likeKutueRef({ kutueId: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = likeKutueRef(dataConnect, likeKutueVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.like_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.like_insert);
});
```

