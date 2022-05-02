export type Options = {
  rethinkIdBaseUri?: string;
  appId: string;
  signUpRedirectUri: string;
  logInRedirectUri: string;
  onLogInComplete: () => void;
};

export type Permission = {
  id: string;
  tableName: string;
  userId: string;
  permission: string;
  // condition: object; // not yet implemented
};

export type IdTokenDecoded = {
  at_hash: string;
  aud: string[];
  auth_time: number; // timestamp
  exp: number; // timestamp
  iat: number; // timestamp
  iss: string;
  jti: string;
  rat: number; // timestamp
  sid: string;
  sub: string; // user ID
  // Open ID Connect scoped data
  // - 'email' scope
  email?: string;
  email_verified?: boolean;
  // - 'profile' scope
  name?: string;
};

export type SubscribeListener = (changes: { new_val: object; old_val: object }) => void;
