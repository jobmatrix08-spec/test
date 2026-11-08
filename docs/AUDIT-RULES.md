# Règles proposées pour `auditLogs`

À intégrer et tester manuellement dans `firestore.rules` avant publication. Ces règles ne sont pas déployées par l’application.

```firestore
match /auditLogs/{logId} {
  allow create: if request.auth != null &&
    exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
    get(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('status', 'active') == 'active' &&
    request.resource.data.ownerId is string &&
    (
      request.auth.uid == request.resource.data.ownerId ||
      get(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('ownerId', '') ==
        request.resource.data.ownerId
    ) &&
    request.resource.data.actor.uid == request.auth.uid &&
    request.resource.data.entity in ['invoice', 'sale', 'product'] &&
    request.resource.data.action in ['create', 'update', 'cancel', 'delete'];

  allow read: if request.auth != null &&
    exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
    get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin' &&
    get(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('ownerId', request.auth.uid) ==
      resource.data.ownerId;

  allow update, delete: if false;
}
```

Le journal est créé côté client : un utilisateur malveillant pourrait falsifier des données avant envoi. Ces règles limitent l’accès, mais ne rendent pas les événements infalsifiables.
