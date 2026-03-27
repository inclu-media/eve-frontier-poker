import {
  getObjectWithJson,
  getAssemblyWithOwner,
  getOwnedObjectsByType,
  transformToAssembly,
} from "@evefrontier/dapp-kit";

/**
 * STEP 5 (optional) — When useSmartObject isn't enough.
 * getAssemblyWithOwner() for assembly + character;
 * transformToAssembly() for typed Assembly from raw move object.
 * Other helpers: executeGraphQLQuery, getOwnedObjectsByType, getObjectsByType, getSingletonObjectByType.
 */
async function fetchAssemblyInfo(assemblyId: string) {
  const { moveObject, assemblyOwner } = await getAssemblyWithOwner(assemblyId);

  if (!moveObject) {
    console.error("Assembly not found");
    return null;
  }

  // 3. Or transform to typed Assembly object
  const assembly = await transformToAssembly(assemblyId, moveObject, {
    character: assemblyOwner,
  });

  return { assembly, assemblyOwner };
}

/** STEP 5 — getObjectWithJson() for object by ID with JSON. */
async function fetchObjectData(objectId: string) {
  const result = await getObjectWithJson(objectId);

  const json = result.data?.object?.asMoveObject?.contents?.json;
  return json;
}

/** STEP 5 — getOwnedObjectsByType() for owned objects by type and wallet address. */
async function fetchUserAssemblies(
  walletAddress: string,
  assemblyType: string,
) {
  const result = await getOwnedObjectsByType(walletAddress, assemblyType);

  const objectAddresses = result.data?.address?.objects?.nodes.map(
    (node) => node.address,
  );
  return objectAddresses;
}

export { fetchAssemblyInfo, fetchObjectData, fetchUserAssemblies };
