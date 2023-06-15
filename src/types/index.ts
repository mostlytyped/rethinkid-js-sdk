/**
 * RethinkID constructor options
 */
export type CommonOptions = {
  appId: string;
};

export type AuthOptions = {
  /**
   * The URI the auth server redirects to with an auth code, after successful approving a login request.
   */
  loginRedirectUri: string;

  /**
   * Optionally set an alternative to the default URI.
   */
  oAuthUri?: string;
};

export type ApiOptions = {
  /**
   * Optionally set an alternative to the default URI.
   */
  dataApiUri?: string;
};

export type PermissionTemplate = {
  tableName: string;
  types: PermissionType[];
  condition?: PermissionCondition;
};

export type Permission = {
  id?: string; // for permissionSet ID is present if updating, absent if inserting
  tableName: string;
  userId: string;
  types: PermissionType[];
  condition?: PermissionCondition;
};

export type PermissionType = "read" | "insert" | "update" | "delete";

export type PermissionCondition = {
  rowId?: string; // Permission applies to a specific row ID
  matchUserId?: string; // Permission applies if specified field matches or contains the user's ID
};

export type PermissionsGetOptions = {
  tableName?: string;
  userId?: string;
  type?: "read" | "insert" | "update" | "delete";
};

export type GrantedPermission = {
  id: string;
  userId: string;
  appId: string;
  hostId: string;
  permissionId: string;
  permission: Permission | undefined;
};

export type Link = {
  id: string;
  userId: string;
  appId: string;
  permissionId: string;
  limit: number;
  users: string[] | undefined;
};

export type LinksGetOptions = {
  userId?: string;
};

/**
 * The possible login types. Default is "popup_fallback"
 *
 * "popup_fallback" - Do pop-up login, if the pop-up fails to open, fallback to redirect
 * "popup" - Do pop-up login only. Do not fallback to redirect
 * "redirect" - Do redirect login. Do not open a pop-up
 */
export type LoginType = "popup_fallback" | "popup" | "redirect";

export type SubscribeListener = (changes: { new_val: object; old_val: object }) => void;

export type Message = { message: string };

/**
 * A FilterComparison is an object, that applies a set of comparison operators.
 * Multiple properties are combined with AND. Most comparison operators are self-explanatory
 * logical operators except for contains, which checks if an element is part of an array.
 */
export type FilterComparison = {
  $eq?: string | number;
  $ne?: string | number;
  $gt?: string | number;
  $ge?: string | number;
  $lt?: string | number;
  $le?: string | number;
  $contains?: string | number;
};

/**
 * A FilterObject is an object that either maps
 * - string keys to string | number | boolean | null. This corresponds to an equality operation
 * - string keys to FilterComparison. This corresponds to the operation defined in FilterComparison
 * - $and to FilterObject[]. This combines the result of each FilterObject in the array with AND
 * - $or to FilterObject[]. This combines the result of each FilterObject in the array with OR
 * - $not to FilterObject. This applies NOT to the result of the FilterObject
 * All fields in a FilterObject are combined with an AND.
 * The FilterObject
 * {
 *   $or: [
 *     {
 *       height: {
 *         $gt: 80,
 *         $lt: 140,
 *       },
 *     },
 *     {
 *       weight: {
 *         $gt: 10,
 *         $lt: 25,
 *       },
 *     },
 *   ],
 *   age: { $lt: 12 },
 * }
 * would result in "((height > 80 AND height < 140) OR (weight > 10 AND weight < 25)) AND (age < 12)"
 */
export type FilterObject = {
  $and?: FilterObject[];
  $or?: FilterObject[];
  $not: FilterObject;
  // Arbitrary fields cannot be FilterObject or FilterObject[]. These types are declared as options because typescript requires it.
  [field: string]: FilterComparison | string | number | boolean | null | FilterObject | FilterObject[];
};

/**
 * An OrderBy object specifies orderings of results.
 * Example: { height: "desc", age: "asc" }
 */
export type OrderBy = {
  [field: string]: "asc" | "desc";
};

export type User = {
  id: string;
  name: string | undefined;
  email: string | undefined;
};

export type Contact = {
  id: string;
  userId: string;
  contactId: string;
  connected: boolean; // flag to signal if contact is connected (you are trusted by this contact)
};
export type ConnectionRequest = {
  id: string;
  userId: string;
  contactId: string;
};

export type TableOptions = {
  onCreate?: () => Promise<void>;
  userId?: string;
};
