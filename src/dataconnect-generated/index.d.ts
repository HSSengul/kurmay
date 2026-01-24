import { ConnectorConfig, DataConnect, QueryRef, QueryPromise, MutationRef, MutationPromise } from 'firebase/data-connect';

export const connectorConfig: ConnectorConfig;

export type TimestampString = string;
export type UUIDString = string;
export type Int64String = string;
export type DateString = string;




export interface CreateKutueData {
  kutue_insert: Kutue_Key;
}

export interface CreateKutueVariables {
  content: string;
  imageUrl?: string | null;
}

export interface Follow_Key {
  followerId: UUIDString;
  followeeId: UUIDString;
  __typename?: 'Follow_Key';
}

export interface Kutue_Key {
  id: UUIDString;
  __typename?: 'Kutue_Key';
}

export interface LikeKutueData {
  like_insert: Like_Key;
}

export interface LikeKutueVariables {
  kutueId: UUIDString;
}

export interface Like_Key {
  userId: UUIDString;
  kutueId: UUIDString;
  __typename?: 'Like_Key';
}

export interface ListKutuesByUserData {
  kutues: ({
    id: UUIDString;
    content: string;
    imageUrl?: string | null;
    createdAt: TimestampString;
  } & Kutue_Key)[];
}

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

export interface Reply_Key {
  id: UUIDString;
  __typename?: 'Reply_Key';
}

export interface User_Key {
  id: UUIDString;
  __typename?: 'User_Key';
}

interface CreateKutueRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateKutueVariables): MutationRef<CreateKutueData, CreateKutueVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateKutueVariables): MutationRef<CreateKutueData, CreateKutueVariables>;
  operationName: string;
}
export const createKutueRef: CreateKutueRef;

export function createKutue(vars: CreateKutueVariables): MutationPromise<CreateKutueData, CreateKutueVariables>;
export function createKutue(dc: DataConnect, vars: CreateKutueVariables): MutationPromise<CreateKutueData, CreateKutueVariables>;

interface ListKutuesByUserRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListKutuesByUserData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<ListKutuesByUserData, undefined>;
  operationName: string;
}
export const listKutuesByUserRef: ListKutuesByUserRef;

export function listKutuesByUser(): QueryPromise<ListKutuesByUserData, undefined>;
export function listKutuesByUser(dc: DataConnect): QueryPromise<ListKutuesByUserData, undefined>;

interface LikeKutueRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: LikeKutueVariables): MutationRef<LikeKutueData, LikeKutueVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: LikeKutueVariables): MutationRef<LikeKutueData, LikeKutueVariables>;
  operationName: string;
}
export const likeKutueRef: LikeKutueRef;

export function likeKutue(vars: LikeKutueVariables): MutationPromise<LikeKutueData, LikeKutueVariables>;
export function likeKutue(dc: DataConnect, vars: LikeKutueVariables): MutationPromise<LikeKutueData, LikeKutueVariables>;

interface ListKutuesRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListKutuesData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<ListKutuesData, undefined>;
  operationName: string;
}
export const listKutuesRef: ListKutuesRef;

export function listKutues(): QueryPromise<ListKutuesData, undefined>;
export function listKutues(dc: DataConnect): QueryPromise<ListKutuesData, undefined>;

