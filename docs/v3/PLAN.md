# Cardex v3 : plan

Rédigé le 28/11/2026. Demande : alertes de stock (en ligne et en magasin physique), calendrier des sorties (cartes,
coffrets…), meilleur prix pour les collectionneurs, espace investissement avec les outils utiles.
Les cinq rapports de recherche (en anglais, avec leurs sources) sont dans `recherches/`.

## 1. Choix déjà faits par le propriétaire

- Pour les proches d'abord, public ensuite : tout est construit pour pouvoir s'ouvrir plus tard.
- Les alertes arrivent en notifications de Cardex (pas sur Discord).
- Le bot de stock (Poké Stock) tourne sur le PC du propriétaire.
- Magasins physiques : signalements des utilisateurs, plus les sites qui affichent la dispo par magasin.

## 2. Ce que disent les recherches

- **Notifications** (D) : il faut un petit serveur. Le meilleur choix est Cloudflare (un Worker et une base D1 stockée
  en Europe) : gratuit pour une vingtaine de personnes, environ 5 $ par mois vers 5 000. Il se déploie avec curl,
  sans Node. Sur iPhone, il faut avoir ajouté Cardex à l'écran d'accueil.
- **Calendrier** (A) : aucune source française ne donne de date lisible par un programme, sauf le fil RSS des
  communiqués de presse officiels. Cardmarket liste les nouveaux produits environ 11 semaines avant leur sortie, et
  les premières offres de vendeurs signalent les précommandes. Prochaine sortie officielle : Méga-Évolution – Poings
  Fluides (ME07) le samedi 6 février 2027, avant-premières à partir du 23 janvier.
- **Magasins physiques** (C) : aucune enseigne ne permet de lire son stock magasin par magasin sans enfreindre ses
  règles ou ses protections. Le stock en rayon viendra donc des signalements, avec un bouton « Vérifier sur le site ».
  La liste des magasins vient d'OpenStreetMap : environ 13 000 magasins pour 15 enseignes, 273 Ko compressés.
- **Boutiques en ligne** (B) : prix et stock lisibles sur Leclerc, Auchan, JouéClub, La Grande Récré, Ludum,
  Investcollect et les boutiques Shopify. Fnac, Cultura, Cdiscount, Amazon, Carrefour, King Jouet, Micromania, Smyths
  et Pokémon Center bloquent les robots : lien seulement. Une fois public, les flux officiels des programmes
  d'affiliation (Awin : Fnac, Cultura, Cdiscount) donneront leurs prix légalement.
- **Cartes à l'unité** (B) : le « plus bas » de Cardmarket couvre toutes les langues et tous les états. Il faut le
  dire, et donner un lien direct vers les offres en français en bon état.
- **Investissement** (E) : aucun outil existant ne couvre le marché français. Cardex a déjà les données pour la
  performance du portefeuille, un indice du scellé par ère, les alertes et les calculateurs. Il manque l'historique
  quotidien long (il n'existe que depuis le 09/09/2026) et le volume des ventes (Cardmarket ne le publie pas).

## 3. Architecture

```
 Cardex (GitHub Pages)  ── écrans, collection sur le téléphone, service worker (notifications)
        │   ▲
        ▼   │ notifications (Web Push)
 Serveur Cloudflare (Worker + D1 en Europe + file d'envoi)
   appareils, invitations, suivis, signalements, journal des alertes
        ▲                         ▲
        │ cotes, sorties          │ stock en ligne (signé)
 GitHub Actions (déjà là)      Poké Stock (PC)
   chaque jour : cotes, détecteurs de sorties, alertes de prix
   chaque mois : annuaire des magasins (OpenStreetMap)
```

- Le site reste statique. Seul ce qui doit être partagé ou poussé passe par le serveur.
- Le bot et GitHub Actions signent leurs envois avec un secret (HMAC). Aucun secret n'est commité.
- Aucune boutique n'est lue depuis GitHub Actions : seul le PC lit les boutiques, et seulement celles qui le permettent.

## 4. Onglets

Cinq onglets restent le maximum sur téléphone. Proposition :

| Onglet | Contenu |
|---|---|
| Collection | comme aujourd'hui, plus **Decks** (déplacé ici, car il compare les decks à la collection) |
| Séries | comme aujourd'hui |
| Scanner | comme aujourd'hui, plus le scan du code-barres d'un produit scellé pour le signaler en magasin |
| **Acheter** | Sorties (calendrier), Stock (en ligne et en magasin, Signaler), Envies, Scellé (catalogue, « Où acheter ») |
| **Investir** | Portefeuille (Mon scellé et performance), Cotes (hausses, baisses), Indices, Outils (calculateurs, fiscalité) |

L'onglet Marché actuel est réparti entre Acheter et Investir. Les anciennes adresses redirigent vers les nouvelles.

## 5. Étapes

### Étape 1 : sans serveur (peut commencer tout de suite)
- **Calendrier des sorties** : `data/calendar.json` (une source par entrée), rempli par des détecteurs quotidiens :
  communiqués officiels (RSS, date lue dans le texte), nouveaux produits Cardmarket, premières offres (précommande),
  sortie confirmée par TCGdex. Écran Sorties par mois, filtres par type, prix public quand il est connu. Abonnement
  d'agenda (`.ics`) pour voir les sorties dans l'agenda du téléphone.
- **Investir, premiers outils** : avertissement (« pas un conseil en investissement »), performance du portefeuille
  (évolution, rendement annualisé, TRI, comparaison au Livret A et à l'inflation), valeur nette à la revente,
  calculateur de frais de vente (Cardmarket, La Poste 2027), prix par booster et multiple du prix constaté en
  magasin, indice du scellé par ère, objectif de prix sur les produits suivis, fiche fiscalité (seuil de 5 000 €,
  taxe de 6,5 % ou plus-values, seuil DAC7) avec un journal des ventes.
- **Meilleur prix** : « dès X € » libellé « toutes langues, tous états » ; lien Cardmarket filtré (français, bon
  état) ; « Où acheter » sur chaque produit scellé (liens vers les boutiques).
- **Données** : garder chaque jour le prix moyen et le plus bas du scellé, pour la volatilité et la liquidité plus tard.
- **Onglets** réorganisés comme au §4.

### Étape 2 : notifications (serveur Cloudflare)
- À faire par le propriétaire : créer un compte Cloudflare gratuit et un jeton d'accès (guidé pas à pas), gardé dans
  un fichier local jamais commité.
- Serveur : appareils, invitations par code (une par proche, révocable), suivis, envoi des notifications.
- Notifications : prix d'une envie atteint (marche aussi sur iPhone, ce que la vérification actuelle ne fait pas),
  sortie annoncée, précommande ouverte, date changée, rappel la veille de la sortie.
- Réglages : choix des notifications, heures calmes, « Supprimer mes données », note de confidentialité.

### Étape 3 : stock en ligne
- Catalogue des pages produit par boutique : plans de site autorisés, rapprochés du catalogue Cardmarket.
- Poké Stock demande au serveur la liste des produits suivis, lit ces pages sur les sites autorisés, puis envoie
  prix et stock. Alerte de réassort aux personnes qui suivent le produit.
- « Où acheter » affiche le prix et le stock en direct de ces boutiques, avec l'heure de lecture.

### Étape 4 : magasins physiques
- Annuaire des magasins (OpenStreetMap, mis à jour chaque mois, mention « © les contributeurs d'OpenStreetMap »).
  « Mes magasins » choisis par l'utilisateur (jamais sa position GPS).
- Signaler en trois gestes : le produit (scan du code-barres ou envies), le magasin, puis « en rayon », « mise en
  rayon » ou « rayon vide », avec une quantité approximative et la limite par client.
- Le signalement expire seul : 3 h pour un produit sorti il y a moins de 14 jours, 24 h sinon. « Toujours là »
  prolonge, « plus rien » ferme.
- Notification aux personnes qui suivent le produit, le magasin ou le département. Une seule par produit et par
  magasin, regroupée si le produit apparaît dans plusieurs magasins.
- Pas de photos au début (stockage et modération). Limites par appareil (5 par heure, 20 par jour).

### Plus tard : ouverture au public
- Comptes (lien par e-mail ou clé d'accès), pages légales (mentions légales, confidentialité, conditions, signalement
  de contenu), modération, signalements non confirmés tant qu'un utilisateur de confiance ne les a pas validés.
- Flux Awin (Fnac, Cultura, Cdiscount) : prix et dispo des boutiques qui bloquent les robots. Liens marqués
  « affiliés », offres classées par prix total, jamais par commission.
- Offres eBay (bloc séparé), valeur espérée d'un display, calculateur de gradation, volatilité (après 6 mois de
  données quotidiennes), Amazon.
- Coût prévu : environ 5 $ par mois.

## 6. Limites assumées

- Le stock en rayon ne vient que des signalements : il faut assez de monde.
- Pas de stock en direct pour les boutiques qui bloquent les robots, tant qu'il n'y a pas les flux d'affiliation.
- Le bot ne surveille que lorsque le PC est allumé.
- Les cotes Cardmarket mélangent les langues.
- Les taux d'obtention (« pull rates ») des boosters français n'ont jamais été mesurés publiquement : les chiffres
  anglais seront affichés comme estimation.
- Rien n'est un conseil en investissement. Cardex affiche des données, jamais de recommandation d'achat ou de vente.

## 7. À vérifier avant de publier chaque partie

- Fiscalité : taux des prélèvements sociaux sur les plus-values (17,2 % ou 18,6 % depuis la LFSS 2026).
- Commission Cardmarket des vendeurs particuliers (5 %, source secondaire) ; tarifs PSA Europe et PCA.
- Lien Cardmarket filtré (français, bon état) : à tester une fois à la main dans un navigateur.
- Temps de calcul des notifications dans la limite gratuite de Cloudflare (10 ms par appel).
- Conditions de réutilisation des fichiers Cardmarket avant l'ouverture au public.
