import { io, Socket } from "socket.io-client";

import type {
  BzrJwtPayload,
  APIOptions,
  Permission,
  NewPermission,
  SubscribeListener,
  BazaarMessage,
  Contact,
  User,
  GrantedPermission,
  PermissionTemplate,
  Doc,
  BasicLink,
  ContextOptions,
  CollectionGetAllOptions,
  CollectionQueryOptions,
  SharingNotification,
  Notification,
  CreateNotification,
  RawSubscribeListener,
  Org,
  Team,
  PermissionGroup,
  LinksQuery,
  PermissionsQuery,
  GrantedPermissionsQuery,
  NewPermissionGroup,
  EmailMessage,
  CalendarInvite,
} from "../types";
import { BazaarError } from "../utils";
import { tokenKeyName } from "../constants";
import { jwtDecode } from "jwt-decode";

/**
 * The class that encapsulates the low level data API
 * @internal
 */
export class API {
  /**
   * Version of the API
   */
  private version = "v1";

  /**
   * URI for the Data API, Bazaar's realtime data storage service.
   */
  private bazaarUri: string;

  /**
   * A Socket.IO connection to the Data API
   */
  private dataApi: Socket;

  /**
   * ID attribute of the dialog HTML element
   */
  private modalId = "bazaar-modal";

  /**
   * ID attribute of the style HTML element for the modal styles
   */
  private modalStylesId = "bazaar-modal-styles";

  /**
   * Context options
   */
  private context: ContextOptions = {};

  /**
   * A callback to do something upon Data API connection
   */
  onConnect: () => Promise<void>;

  /**
   * A callback to do something when a Data API connection error occurs
   */
  onConnectError: (message: string) => Promise<void>;

  /**
   * The modal and iframe element to perform actions within the BazaarApp context
   */
  private modal: HTMLDialogElement;
  private iframe: HTMLIFrameElement;

  constructor(options: APIOptions, onConnect: () => Promise<void>, onConnectError: (message: string) => Promise<void>) {
    this.bazaarUri = options.bazaarUri;
    if (options.context) {
      this.context = options.context;
    }

    this.onConnect = onConnect;
    this.onConnectError = onConnectError;

    // Make a connection to the Data API if logged in
    this.connect();
  }

  /**
   * Creates a Data API connection with an auth token
   */
  connect(uri: string | undefined = undefined): void {
    const token = localStorage.getItem(tokenKeyName);

    if (!token) {
      return;
    }

    if (!uri) {
      const decodedToken = jwtDecode<BzrJwtPayload>(token);
      uri = decodedToken.uri || this.bazaarUri;
    }

    this.dataApi = io(uri, {
      auth: { token },
    });

    this.dataApi.on("connect", () => {
      console.log("sdk: connected. dataApi.id:", this.dataApi.id);
      this.onConnect();
    });

    this.dataApi.on("connect_error", (error) => {
      let errorMessage = error.message;

      if (error.message.includes("Unauthorized")) {
        errorMessage = "Unauthorized";
      } else if (error.message.includes("TokenExpiredError")) {
        errorMessage = "Token expired";
      }

      this.onConnectError(errorMessage);
    });
  }

  /**
   * Makes sure a connection to the Data API has been made.
   */
  private waitForConnection: () => Promise<true> = () => {
    if (!this.dataApi) {
      return Promise.reject(new Error("Uninitialized data API. Possible unauthenticated request"));
    }

    return new Promise((resolve, reject) => {
      if (this.dataApi.connected) {
        resolve(true);
      } else {
        this.dataApi.on("connect", () => {
          resolve(true);
        });
        // Don't wait for connection indefinitely
        setTimeout(() => {
          reject(new Error("Timeout waiting for on connect"));
        }, 3000);
      }
    });
  };

  /**
   * Promisifies a Data API emit event
   *
   * @param event - A Data API event name, like `collections:create`
   * @param payload -
   */
  private asyncEmit = async (event: string, payload: any) => {
    await this.waitForConnection();
    return new Promise((resolve, reject) => {
      this.dataApi.emit(event, payload, (response: any) => {
        if (response.error) {
          reject(
            new BazaarError(
              response.error.type,
              `${response.error.message} (event: ${event}, payload: ${JSON.stringify(payload)})`,
            ),
          );
        } else {
          resolve(response);
        }
      });
    });
  };

  /**
   * Create context
   *
   * @param options - An optional object for specifying query options.
   * @returns BazaarMessage
   */
  async createContext(options: ContextOptions = {}) {
    if (!options.ownerId) {
      return { message: "Own user context exists" };
    }
    return this.asyncEmit(this.version + ":createContext", options) as Promise<{ uri?: string; message: string }>;
  }

  //
  // Collection API
  //

  /**
   * Gets a collection doc
   *
   * @param collectionName - The name of the collection to read
   * @param docId - The doc ID
   * @returns A document
   */
  async collectionGetOne<T extends Doc>(collectionName: string, docId: string) {
    const payload = { collectionName, docId };
    Object.assign(payload, this.context);
    return this.asyncEmit(this.version + ":collection:getOne", payload) as Promise<{ data: T | null }>;
  }

  /**
   * Gets all collection documents for a given filter.
   *
   * @param collectionName - The name of the collection to read.
   * @param options - An optional object for specifying query options.
   * @returns An array of documents
   */
  async collectionGetAll<T extends Doc>(collectionName: string, options: CollectionGetAllOptions = {}) {
    const payload = { collectionName };
    Object.assign(payload, options);
    Object.assign(payload, this.context);
    return this.asyncEmit(this.version + ":collection:getAll", payload) as Promise<{ data: T[] }>;
  }

  /**
   * Subscribes to doc changes.
   *
   * @param collectionName - The name of the collection to subscribe to
   * @param docId - The document ID
   * @param listener - The callback function that receives document change events.
   * @returns An unsubscribe function
   */
  async collectionSubscribeOne<T extends Doc>(collectionName: string, docId: string, listener: SubscribeListener<T>) {
    const payload = { collectionName, docId };
    Object.assign(payload, this.context);

    const response = (await this.asyncEmit(this.version + ":collection:subscribeOne", payload)) as { data: string }; // where data is the subscription handle
    const subscriptionHandle = response.data;

    const rawListener = toRawSubscribeListener(listener);
    this.dataApi.on(subscriptionHandle, rawListener);

    return async () => {
      this.dataApi.off(subscriptionHandle, rawListener);
      const resp = (await this.asyncEmit(
        this.version + ":collection:unsubscribe",
        subscriptionHandle,
      )) as BazaarMessage;
      return resp.message;
    };
  }

  /**
   * Subscribes to collection changes. Private by default, or public with read permission.
   *
   * @param collectionName - The name of the collection to subscribe to.
   * @param options - An optional object for specifying query options.
   * @param listener - The callback function that receives document change events.
   * @returns An unsubscribe function
   */
  async collectionSubscribeAll<T extends Doc>(
    collectionName: string,
    options: CollectionQueryOptions = {},
    listener: SubscribeListener<T>,
  ) {
    const payload = { collectionName };
    Object.assign(payload, options);
    Object.assign(payload, this.context);

    const response = (await this.asyncEmit(this.version + ":collection:subscribeAll", payload)) as { data: string }; // where data is the subscription handle
    const subscriptionHandle = response.data;

    const rawListener = toRawSubscribeListener(listener);
    this.dataApi.on(subscriptionHandle, rawListener);

    return async () => {
      this.dataApi.off(subscriptionHandle, rawListener);
      const resp = (await this.asyncEmit(
        this.version + ":collection:unsubscribe",
        subscriptionHandle,
      )) as BazaarMessage;
      return resp.message;
    };
  }

  /**
   * Inserts a collection doc.
   *
   * @param collectionName - The name of the collection to operate on.
   * @param doc - The doc to insert.
   * @returns Where `data` is the array of new doc IDs (only generated IDs)
   */
  async collectionInsertOne(collectionName: string, doc: object) {
    const payload = { collectionName, doc };
    Object.assign(payload, this.context);

    return this.asyncEmit(this.version + ":collection:insertOne", payload) as Promise<{ data: string }>;
  }

  /**
   * Updates all collection docs, or a single doc if doc ID exists.
   *
   * @param collectionName - The name of the collection to operate on.
   * @param docId - ID of document to update
   * @param doc - Document changes
   */
  async collectionUpdateOne(collectionName: string, docId: string, doc: object) {
    const payload = { collectionName, docId, doc };
    Object.assign(payload, this.context);

    return this.asyncEmit(this.version + ":collection:updateOne", payload) as Promise<BazaarMessage>;
  }

  /**
   * Replaces a collection doc. Private by default, or public with insert, update, delete permissions.
   *
   * @param collectionName - The name of the collection to operate on.
   * @param docId - ID of document to replace.
   * @param doc - The new doc.
   */
  async collectionReplaceOne(collectionName: string, docId: string, doc: object) {
    const payload = { collectionName, docId, doc };
    Object.assign(payload, this.context);

    return this.asyncEmit(this.version + ":collection:replaceOne", payload) as Promise<BazaarMessage>;
  }

  /**
   * Deletes a doc
   *
   * @param collectionName - The name of the collection to operate on.
   * @param docId - ID of document to delete
   */
  async collectionDeleteOne(collectionName: string, docId: string) {
    const payload = { collectionName, docId };
    Object.assign(payload, this.context);

    return this.asyncEmit(this.version + ":collection:deleteOne", payload) as Promise<BazaarMessage>;
  }

  /**
   * Deletes all collection docs matching an optional filter.
   *
   * @param collectionName - The name of the collection to operate on.
   * @param options - An optional object for specifying query options.
   */
  async collectionDeleteAll(collectionName: string, options: CollectionQueryOptions = {}) {
    const payload = { collectionName };
    Object.assign(payload, options);
    Object.assign(payload, this.context);

    return this.asyncEmit(this.version + ":collection:deleteAll", payload) as Promise<BazaarMessage>;
  }

  //
  // Collections API
  //

  /**
   * Creates a collection.
   */
  async collectionsCreate(collectionName: string) {
    const payload = { collectionName };
    Object.assign(payload, this.context);
    return this.asyncEmit(this.version + ":collections:create", payload) as Promise<BazaarMessage>;
  }

  /**
   * Drops a collection.
   */
  async collectionsDrop(collectionName: string) {
    const payload = { collectionName };
    Object.assign(payload, this.context);
    return this.asyncEmit(this.version + ":collections:drop", payload) as Promise<BazaarMessage>;
  }

  /**
   * Lists all collection names.
   * @returns Where `data` is an array of collection names
   */
  async collectionsList() {
    return this.asyncEmit(this.version + ":collections:list", this.context) as Promise<{ data: string[] }>;
  }

  //
  // Permissions API (permissions, links, granted_permissions, groups)
  //

  /**
   * Lists permissions.
   *
   * @param query - If no options are set, all permissions are returned.
   * @returns All permissions matching query options.
   */
  async permissionsList(query: PermissionsQuery = {}) {
    const payload = { query };
    Object.assign(payload, this.context);
    return this.asyncEmit(this.version + ":permissions:list", payload) as Promise<{ data: Permission[] }>;
  }

  /**
   * Creates a permission.
   */
  async permissionsCreate(permission: NewPermission, notification: SharingNotification) {
    const payload = { permission, notification };
    Object.assign(payload, this.context);
    return this.asyncEmit(this.version + ":permissions:create", payload) as Promise<{
      id: string;
    }>;
  }

  /**
   * Deletes a permission.
   *
   * @param permissionId - The ID of the permission to delete.
   */
  async permissionsDelete(permissionId: string) {
    const payload = { permissionId };
    Object.assign(payload, this.context);
    return this.asyncEmit(this.version + ":permissions:delete", payload) as Promise<BazaarMessage>;
  }

  /**
   * Creates a permission link.
   */
  async linksCreate(permission: PermissionTemplate, description: string = "", limit: number = 1) {
    const payload = { permission, description, limit };
    Object.assign(payload, this.context);
    return this.asyncEmit(this.version + ":links:create", { permission, description, limit }) as Promise<{
      data: BasicLink;
    }>;
  }

  /**
   * Lists permission links.
   *
   * @param query - If no options are set, all links are returned.
   * @returns Where `data` is an array of links
   */
  async linksList(query: LinksQuery = {}) {
    const payload = { query };
    Object.assign(payload, this.context);
    return this.asyncEmit(this.version + ":links:list", payload) as Promise<{ data: BasicLink[] }>;
  }

  /**
   * Subscribes to link changes
   *
   * @param query -
   * @param options -
   * @param listener - The callback function that receives link change events.
   * @returns An unsubscribe function
   */
  async linksSubscribe(query: LinksQuery = {}, listener: SubscribeListener<BasicLink>) {
    const payload = { query };
    Object.assign(payload, this.context);
    const response = (await this.asyncEmit(this.version + ":links:subscribe", payload)) as {
      data: string;
    }; // where data is the subscription handle
    const subscriptionHandle = response.data;

    const rawListener = toRawSubscribeListener(listener);
    this.dataApi.on(subscriptionHandle, rawListener);

    return async () => {
      this.dataApi.off(subscriptionHandle, rawListener);
      return this.asyncEmit(this.version + ":links:unsubscribe", subscriptionHandle) as Promise<BazaarMessage>;
    };
  }

  /**
   * Deletes permission links.
   */
  async linksDelete(linkId: string) {
    return this.asyncEmit(this.version + ":links:delete", { linkId }) as Promise<BazaarMessage>;
  }

  /**
   * Lists granted permissions
   *
   * @returns a list of granted permissions
   */
  async grantedPermissionsList(query: GrantedPermissionsQuery = {}) {
    const payload = { query };
    Object.assign(payload, this.context);
    return this.asyncEmit(this.version + ":granted_permissions:list", payload) as Promise<{
      data: GrantedPermission[];
    }>;
  }

  /**
   * Subscribes to granted permissions changes
   *
   * @param listener - The callback function that receives granted permissions change events.
   * @returns An unsubscribe function
   */
  async grantedPermissionsSubscribe(
    query: GrantedPermissionsQuery = {},
    listener: SubscribeListener<GrantedPermission>,
  ) {
    const payload = { query };
    Object.assign(payload, this.context);
    const response = (await this.asyncEmit(this.version + ":granted_permissions:subscribe", payload)) as {
      data: string;
    }; // where data is the subscription handle
    const subscriptionHandle = response.data;

    const rawListener = toRawSubscribeListener(listener);
    this.dataApi.on(subscriptionHandle, rawListener);

    return async () => {
      this.dataApi.off(subscriptionHandle, rawListener);
      return this.asyncEmit(
        this.version + ":granted_permissions:unsubscribe",
        subscriptionHandle,
      ) as Promise<BazaarMessage>;
    };
  }

  /**
   * Deletes a granted permission
   *
   * @param grantedPermissionId - The ID of the granted permission to delete
   */
  async grantedPermissionsDelete(grantedPermissionId: string) {
    const payload = { grantedPermissionId };
    return this.asyncEmit(this.version + ":granted_permissions:delete", payload) as Promise<BazaarMessage>;
  }

  /**
   * Get a group
   *
   * @param groupId - The ID of the group to get.
   */
  async groupsGet(groupId: string) {
    const payload = { groupId };
    Object.assign(payload, this.context);
    return this.asyncEmit(this.version + ":groups:get", payload) as Promise<{ data: PermissionGroup }>;
  }

  /**
   * Lists groups.
   *
   * @returns All groups matching query.
   */
  async groupsList() {
    return this.asyncEmit(this.version + ":groups:list", this.context) as Promise<{ data: PermissionGroup[] }>;
  }

  /**
   * Creates a group.
   */
  async groupsCreate(group: NewPermissionGroup) {
    const payload = { group };
    Object.assign(payload, this.context);
    return this.asyncEmit(this.version + ":groups:create", payload) as Promise<{
      id: string;
    }>;
  }

  /**
   * Add member to a group.
   *
   * @param groupId - The ID of the group
   * @param userId - The ID of the user
   */
  async groupsAddMember(groupId: string, userId: string) {
    const payload = { groupId, userId };
    Object.assign(payload, this.context);
    return this.asyncEmit(this.version + ":groups:addMember", payload) as Promise<BazaarMessage>;
  }

  /**
   * Remove member from a group.
   *
   * @param groupId - The ID of the group
   * @param userId - The ID of the user
   *
   */
  async groupsRemoveMember(groupId: string, userId: string) {
    const payload = { groupId, userId };
    Object.assign(payload, this.context);
    return this.asyncEmit(this.version + ":groups:removeMember", payload) as Promise<BazaarMessage>;
  }

  /**
   * Deletes a group.
   *
   * @param groupId - The ID of the group to delete.
   */
  async groupsDelete(groupId: string) {
    const payload = { groupId };
    Object.assign(payload, this.context);
    return this.asyncEmit(this.version + ":groups:delete", payload) as Promise<BazaarMessage>;
  }

  //
  // Notifications API
  //

  /**
   * Creates a notification.
   */
  async notificationsCreate(notification: CreateNotification) {
    return this.asyncEmit(this.version + ":notifications:create", { notification }) as Promise<{ data: Notification }>;
  }

  /**
   * Lists notifications.
   *
   * @param options - If no options are set, all non-hidden notifications are returned.
   * @returns Where `data` is an array of notifications
   */
  async notificationsList(
    options: {
      includeHidden?: boolean;
      senderId?: string;
      startTs?: Date;
      endTs?: Date;
    } = {},
  ) {
    return this.asyncEmit(this.version + ":notifications:list", options) as Promise<{ data: Notification[] }>;
  }

  /**
   * Subscribes to notification changes
   *
   * @param options -
   * @param listener - The callback function that receives notification change events.
   * @returns An unsubscribe function
   */
  async notificationsSubscribe(
    options: {
      includeHidden?: boolean;
      senderId?: string;
      startTs?: Date;
      endTs?: Date;
    } = {},
    listener: SubscribeListener<Notification>,
  ) {
    const response = (await this.asyncEmit(this.version + ":notifications:subscribe", options)) as {
      data: string;
    }; // where data is the subscription handle
    const subscriptionHandle = response.data;

    const rawListener = toRawSubscribeListener(listener);
    this.dataApi.on(subscriptionHandle, rawListener);

    return async () => {
      this.dataApi.off(subscriptionHandle, rawListener);
      return this.asyncEmit(this.version + ":notifications:unsubscribe", subscriptionHandle) as Promise<BazaarMessage>;
    };
  }

  /**
   * Hides notifications.
   */
  async notificationsHide(notificationId: string) {
    return this.asyncEmit(this.version + ":notifications:hide", { notificationId }) as Promise<BazaarMessage>;
  }

  /**
   * Deletes notifications.
   */
  async notificationsDelete(notificationId: string) {
    return this.asyncEmit(this.version + ":notifications:delete", { notificationId }) as Promise<BazaarMessage>;
  }

  //
  // Social API
  //

  /**
   * Gets the user info for a given ID or handle.
   * @param payload - The ID or handle of the user, defaults to logged in user's ID.
   */
  async usersGet(payload: { userId?: string; handle?: string } = {}) {
    return this.asyncEmit(this.version + ":users:get", payload) as Promise<{ data: User }>;
  }

  /**
   * Lists contacts
   * @returns a list of contacts
   */
  async contactsList() {
    const payload = {};
    return this.asyncEmit(this.version + ":contacts:list", payload) as Promise<{ data: Contact[] }>;
  }

  /**
   * Subscribes to contacts changes
   *
   * @param listener - The callback function that receives contact change events.
   * @returns An unsubscribe function
   */
  async contactsSubscribe(listener: SubscribeListener<Contact>) {
    const response = (await this.asyncEmit(this.version + ":contacts:subscribe", {})) as {
      data: string;
    }; // where data is the subscription handle
    const subscriptionHandle = response.data;

    const rawListener = toRawSubscribeListener(listener);
    this.dataApi.on(subscriptionHandle, rawListener);

    return async () => {
      this.dataApi.off(subscriptionHandle, rawListener);
      return this.asyncEmit(this.version + ":contacts:unsubscribe", subscriptionHandle) as Promise<BazaarMessage>;
    };
  }

  //
  // Organizations API
  //

  /**
   * Gets all orgs user is member/admin.
   */
  async organizationsList() {
    const payload = {};
    return this.asyncEmit(this.version + ":organizations:list", payload) as Promise<{ data: Org[] }>;
  }

  /**
   * Gets the org info for a given ID or handle.
   * @param payload - The ID or handle of the org, requires one of the two.
   */
  async organizationsGet(payload: { userId?: string; handle?: string }) {
    return this.asyncEmit(this.version + ":organizations:get", payload) as Promise<{ data: Org }>;
  }

  /**
   * Lists teams
   * @returns a list of teams
   */
  async teamsList(payload: { type?: "user" | "org" }) {
    return this.asyncEmit(this.version + ":teams:list", payload) as Promise<{ data: Team[] }>;
  }

  //
  // Email API
  //

  /**
   * Send email message
   * @returns
   */
  async emailSendMessage(emailMessage: EmailMessage) {
    return this.asyncEmit(this.version + ":email:sendMessage", emailMessage) as Promise<{ message: string }>;
  }

  /**
   * Send email event
   * @returns
   */
  async emailSendCalendarInvite(calendarInvite: CalendarInvite) {
    return this.asyncEmit(this.version + ":email:sendCalendarInvite", calendarInvite) as Promise<{ message: string }>;
  }

  //
  // Modal
  //

  private onModalMessage: (event: MessageEvent) => void;
  private onModalClose: () => void;

  private closeModal() {
    if (this.onModalMessage) {
      window.removeEventListener("message", this.onModalMessage);
      this.onModalMessage = undefined;
    }
    if (this.onModalClose) {
      this.onModalClose();
      this.onModalClose = undefined;
    }
    this.modal.close();
  }

  /**
   * Opens a modal
   */
  openModal(
    path: string,
    onMessage: ((msg: string) => void) | undefined = undefined,
    onClose: (() => void) | undefined = undefined,
  ) {
    this.initializeModal();
    this.iframe.src = this.bazaarUri + path;
    this.modal.showModal();
    this.onModalClose = onClose;
    this.onModalMessage = (event) => {
      // Only handle messages from our iframe
      if (this.iframe && event.source !== this.iframe.contentWindow) return;
      if (event.data && event.data.command) {
        // On the login screen there are a lot of events with
        // event.data.command==="calculateSubFramePositioning"
        return;
      }
      if (onMessage && typeof onMessage === "function") {
        onMessage(event.data);
      }
      this.closeModal();
    };
    window.addEventListener("message", this.onModalMessage);
    return;
  }

  /**
   * Creates and appends a modal to the DOM
   */
  initializeModal() {
    const modal = document.getElementById(this.modalId);
    if (modal) return;

    // Initialize modal
    this.modal = document.createElement("dialog");
    this.modal.setAttribute("id", this.modalId);
    // Needed to hide a white bar at the bottom of the dialog
    this.modal.style.backgroundColor = "oklch(.178606 .034249 265.754874)"; // --b3
    this.modal.style.width = "min(700px, 100vw)";
    this.modal.style.borderWidth = "0";
    this.modal.style.padding = "0";
    this.modal.style.margin = "auto";
    this.modal.style.borderRadius = "1rem";

    const style = document.createElement("style");
    style.id = this.modalStylesId;
    document.head.appendChild(style);

    // The ::backdrop pseudo property cannot be added with the `.style` syntax
    style.sheet.insertRule(
      `#${this.modalId}::backdrop {
        background: rgba(0,0,0,.8);
      } `,
      0,
    );

    const button = document.createElement("button");
    button.style.borderWidth = "0";
    button.style.fontWeight = "bold";
    button.style.fontSize = "32px";
    button.style.right = "8px";
    button.style.top = "5px";
    button.style.background = "transparent";
    button.style.cursor = "pointer";
    button.style.position = "fixed";
    button.style.zIndex = "10";
    button.style.color = "oklch(.841536 .007965 265.754874)"; // --bc

    button.innerHTML = "&times;";
    button.autofocus = true;
    button.ariaLabel = "Close Bazaar modal";
    button.onclick = () => this.closeModal();
    this.modal.appendChild(button);

    this.iframe = document.createElement("iframe");
    this.iframe.style.width = "100%";
    this.iframe.style.minHeight = "80vh";
    this.iframe.style.borderWidth = "0";
    this.modal.appendChild(this.iframe);

    document.body.appendChild(this.modal);
  }
}

function toRawSubscribeListener<T extends Doc>(listener: SubscribeListener<T>): RawSubscribeListener<T> {
  return (changes) => {
    if (!changes.oldDoc && changes.newDoc && listener.onAdd) {
      return listener.onAdd(changes.newDoc);
    }
    if (changes.oldDoc && changes.newDoc && listener.onChange) {
      return listener.onChange(changes.oldDoc, changes.newDoc);
    }
    if (changes.oldDoc && !changes.newDoc && listener.onDelete) {
      return listener.onDelete(changes.oldDoc);
    }
  };
}
