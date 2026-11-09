# Inventaire des permissions existantes

- Les menus attribués aux utilisateurs sont stockés dans `allowedMenus` et contrôlés par `hasMenuAccess()` ; ils donnent notamment accès aux pages Ventes et Facturation.
- Les droits d’action sont déclarés dans `PERMISSION_FLAGS` et `can()` (`src/lib/permissions.ts`). Ils portent actuellement sur Pièces, Produits, Réparations, Clients et Coran & Adhkar.
- L’interface de gestion des utilisateurs expose les mêmes menus et drapeaux dans `src/components/Users.tsx`. Les rôles stockés restent `admin` / `user` ; casier et technicien sont déduits des menus.
- La suppression de ventes et les outils d’activité dans Paramètres sont réservés au rôle administrateur. Les autres opérations de stock, produits et clients utilisent les drapeaux `delete`, `addEdit` et `adjustStock` existants.
- Aucun nouveau droit n’est ajouté : le réglage de mention est un réglage de boutique existant, et la consultation du journal reste dans les outils administrateur déjà réservés à l’admin.
- Le masquage de l’interface ne remplace pas les règles Firestore. Les règles proposées pour `auditLogs` sont dans `AUDIT-RULES.md` et ne sont pas publiées.
