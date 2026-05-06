# Calcul Trajet 41

Extension Chrome pour calculer rapidement des temps de trajet dans le **Loir-et-Cher (41)**.

## Fonctionnalités

**Mode Simple** — A → B  
Durée, distance et badge de statut selon le temps de trajet (OK / Petit détour / Trop loin).

**Mode Retour Blois** — A → RDVs → Blois  
- Jusqu'à 5 RDVs intermédiaires dynamiques
- Comparaison trajet direct vs. avec détour(s)
- Détail incrémental du temps ajouté par chaque RDV
- **Suggestion d'ordre optimal** : si un autre ordre des RDVs fait gagner ≥ 1 min, l'extension le propose avec le gain estimé
- Lien Google Maps avec tous les waypoints

**Préférences**
- *Autocomplétion* : suggestions BAN (Base Adresse Nationale) filtrées sur le département 41
- *Mémoriser* : restaure automatiquement les derniers RDVs saisis à la prochaine ouverture

## Installation

1. Cloner ou télécharger ce dépôt
2. Ouvrir `chrome://extensions/`
3. Activer le **Mode développeur**
4. Cliquer sur **Charger l'extension non empaquetée** → sélectionner ce dossier

## APIs utilisées

| Service | Usage |
|---|---|
| [BAN](https://api-adresse.data.gouv.fr) | Géocodage — Base Adresse Nationale (filtre dept. 41, 50 req/s/IP) |
| [OSRM](https://router.project-osrm.org) | Calcul des itinéraires et matrice de durées |
| Google Maps | Ouverture du trajet complet (onglet externe) |

Aucune clé API requise. Aucune dépendance externe.

## Structure

```
manifest.json    — Manifest v3
popup.html       — Interface + styles
popup.js         — Toute la logique (~600 lignes)
theme-init.js    — Restauration du thème avant rendu (anti-FOUC, MV3-compatible)
icon.png         — Icône de l'extension
```
