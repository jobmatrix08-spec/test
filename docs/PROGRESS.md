# Suivi des marches v2

## État à la reprise

- Branche de travail : `feature/v2-features`
- Worktree propre à la reprise.
- Les premières validations ont échoué car le HEAD avait supprimé les ajouts de la marche 1 ; ils ont été restaurés dans un commit correctif.
- Après correction, `npm run lint`, `npm run build` et `npm test` réussissent. Le build signale un bundle supérieur à 500 kB.

## Marches

1. Caractéristiques produits — terminée (validée après correction)
2. Journal d'activité — terminée
3. Mention du vendeur + permissions manquantes — en cours
4. Fondation i18n (Français / Arabe tunisien) + RTL — à faire
5. i18n — POS, Products, Sales, Invoices, Clients — à faire
6. i18n — Repairs, Expenses, Reports, Settings, Users — à faire
7. i18n — Dashboard, notifications, audit final — à faire

## Vérification de la marche 1

- Modèles de caractéristiques par défaut et champs personnalisés enregistrés dans les réglages de boutique.
- Attributs optionnels et numéro de série propagés au panier, aux ventes et aux factures.
- Recherche POS/produits étendue aux attributs et au numéro de série, avec normalisation des accents et de la casse pour les suggestions.
- `npm run lint`, `npm run build` et `npm test` réussis.
- Affichage non vérifié visuellement aux largeurs 360/768/1280 px.
- Limite : le PDF produit par `server.ts` n'affiche pas les nouvelles données des lignes ; ce fichier ne peut pas être modifié selon les règles de la demande.

## Vérification de la marche 2

- Métadonnées de création/modification ajoutées aux produits, ventes et factures ; journal `auditLogs` alimenté après les écritures concernées avec échec non bloquant.
- Consultation admin dans Paramètres avec filtres type/utilisateur/période et pagination.
- `docs/AUDIT-RULES.md` contient les règles proposées ; elles ne sont pas publiées.
- `npm run lint`, `npm run build` et `npm test` réussis. Le build signale un bundle supérieur à 500 kB.
- Affichage non vérifié visuellement ; les écritures/lectures de `auditLogs` nécessitent la publication manuelle des règles proposées.
- Limite : journal écrit côté client, donc non infalsifiable ; pagination actuellement côté client après chargement des événements du magasin.
