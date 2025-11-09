class RoomRegistry {
  constructor() {
    this.rooms = new Map();
    this.getOrCreateRoom("global");
  }

  getOrCreateRoom(roomId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        id: roomId,
        users: new Map(),
      });
    }
    return this.rooms.get(roomId);
  }

  addUser(roomId, userId, userData) {
    const room = this.getOrCreateRoom(roomId);
    room.users.set(userId, { ...userData, id: userId });
    return this.listUsers(roomId);
  }

  removeUser(roomId, userId) {
    const room = this.getOrCreateRoom(roomId);
    room.users.delete(userId);
    return this.listUsers(roomId);
  }

  listUsers(roomId) {
    const room = this.getOrCreateRoom(roomId);
    return Array.from(room.users.values());
  }

  updateUser(roomId, userId, updates) {
    const room = this.getOrCreateRoom(roomId);
    const existing = room.users.get(userId);
    if (!existing) {
      return null;
    }
    const next = { ...existing, ...updates, id: userId };
    room.users.set(userId, next);
    return next;
  }

  getUser(roomId, userId) {
    const room = this.getOrCreateRoom(roomId);
    return room.users.get(userId) || null;
  }
}

module.exports = {
  RoomRegistry,
};
