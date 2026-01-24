import { CreateKutueData, CreateKutueVariables, ListKutuesByUserData, LikeKutueData, LikeKutueVariables, ListKutuesData } from '../';
import { UseDataConnectQueryResult, useDataConnectQueryOptions, UseDataConnectMutationResult, useDataConnectMutationOptions} from '@tanstack-query-firebase/react/data-connect';
import { UseQueryResult, UseMutationResult} from '@tanstack/react-query';
import { DataConnect } from 'firebase/data-connect';
import { FirebaseError } from 'firebase/app';


export function useCreateKutue(options?: useDataConnectMutationOptions<CreateKutueData, FirebaseError, CreateKutueVariables>): UseDataConnectMutationResult<CreateKutueData, CreateKutueVariables>;
export function useCreateKutue(dc: DataConnect, options?: useDataConnectMutationOptions<CreateKutueData, FirebaseError, CreateKutueVariables>): UseDataConnectMutationResult<CreateKutueData, CreateKutueVariables>;

export function useListKutuesByUser(options?: useDataConnectQueryOptions<ListKutuesByUserData>): UseDataConnectQueryResult<ListKutuesByUserData, undefined>;
export function useListKutuesByUser(dc: DataConnect, options?: useDataConnectQueryOptions<ListKutuesByUserData>): UseDataConnectQueryResult<ListKutuesByUserData, undefined>;

export function useLikeKutue(options?: useDataConnectMutationOptions<LikeKutueData, FirebaseError, LikeKutueVariables>): UseDataConnectMutationResult<LikeKutueData, LikeKutueVariables>;
export function useLikeKutue(dc: DataConnect, options?: useDataConnectMutationOptions<LikeKutueData, FirebaseError, LikeKutueVariables>): UseDataConnectMutationResult<LikeKutueData, LikeKutueVariables>;

export function useListKutues(options?: useDataConnectQueryOptions<ListKutuesData>): UseDataConnectQueryResult<ListKutuesData, undefined>;
export function useListKutues(dc: DataConnect, options?: useDataConnectQueryOptions<ListKutuesData>): UseDataConnectQueryResult<ListKutuesData, undefined>;
