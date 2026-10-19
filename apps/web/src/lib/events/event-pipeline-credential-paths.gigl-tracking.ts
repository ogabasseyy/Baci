// Single-source re-export: the reviewed GIGL notification credential
// paths live in event-pipeline-gigl-credential-paths.ts. Both boundary
// consumers (the credential manifest and the boundary test) must
// certify the same graph, so this module defines no second copy.
export { eventPipelineGiglCredentialPaths as giglTrackingCredentialPaths } from './event-pipeline-gigl-credential-paths';
