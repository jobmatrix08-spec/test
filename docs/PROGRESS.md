# Suivi des marches v2

## État à la reprise

- Branche de travail : `feature/v2-features`
- Worktree propre à la reprise.
- État de départ : `npm run lint` réussi ; `npm run build` réussi avec l’avertissement de bundle supérieur à 500 kB.
- Les premières validations ont échoué car le HEAD avait supprimé les ajouts de la marche 1 ; ils ont été restaurés dans un commit correctif.
- Après correction, `npm run lint`, `npm run build` et `npm test` réussissent. Le build signale un bundle supérieur à 500 kB.

## Marches

1. Caractéristiques produits — terminée (validée après correction)
2. Journal d'activité — terminée
3. Mention du vendeur + permissions manquantes — terminée
4. Fondation i18n (Français / Arabe tunisien) + RTL — terminée
5. i18n — POS, Products, Sales, Invoices, Clients — terminée
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

## Vérification de la marche 3

- Attribution du vendeur via `createdBy` dans les transactions POS et de création de facture ; le nom est conservé dans les nouvelles ventes/factures, les anciennes restent sans mention.
- Réglage boutique existant « Mention du vendeur » (Aucun / Initiale / Nom court, Initiale par défaut) utilisé sur le ticket imprimable.
- Permissions existantes inventoriées dans `docs/PERMISSIONS-INVENTORY.md` ; aucune permission nouvelle ni changement Firestore.
- `npm run lint` et `npm run build` réussis au départ et après vérification ; avertissement du bundle supérieur à 500 kB.
- Affichage imprimé non vérifié visuellement.

## Vérification de la marche 4

- Initialisation i18next/react-i18next avec 14 namespaces JSON par langue, français par défaut et fallback français.
- Langue sauvegardée dans `localStorage` sous gestion d’erreur et dans `users.preferredLanguage` lorsqu’un profil authentifié est disponible ; sélecteur dans le Header et Login.
- `lang`/`dir` suivent la langue choisie ; Noto Sans Arabic appliqué uniquement en arabe. Les libellés de navigation, Login, les nouveaux champs produit, le journal d’activité et les métadonnées vendeur sont traduits.
- Dates du Header, ticket et journal formatées via `Intl` en `fr-TN` / `ar-TN` avec chiffres latins.
- `npm run lint`, `npm run build` et `npm test` réussis (39 tests). Le build signale toujours un bundle supérieur à 500 kB.
- RTL et impression non vérifiés visuellement aux largeurs 360/768/1280 px.

## Vérification de la marche 5

- POS, produits, historique des ventes, factures, clients, sélecteur client et création rapide de client traduits en français et arabe tunisien ; données saisies et valeurs métier conservées.
- Styles directionnels des écrans concernés convertis en propriétés logiques.
- Réglage boutique « Langue des documents » (français par défaut / arabe / bilingue) ajouté ; tickets imprimés utilisent des libellés, dates et direction selon ce réglage, avec couleurs d’impression fixes.
- `npm run lint`, `npm run build` et `npm test` réussis (39 tests). Le build signale toujours un bundle supérieur à 500 kB. Les namespaces touchés ont des clés fr/ar correspondantes.
- Interface, RTL et impression non vérifiés visuellement aux largeurs 360/768/1280 px.
- Limite : `server.ts` génère encore les PDF de factures avec des libellés français fixes et ne lit pas `documentLanguage`. La préférence est transmise par le client, mais le rendu PDF du serveur ne peut pas être traduit sans modifier le fichier interdit.
