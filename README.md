# Calcul Trajet 41

Extension Chrome pour calculer rapidement des temps de trajet dans le **Loir-et-Cher (41)**.

## Fonctionnalités

**Mode Simple** — A → B  
Durée, distance et badge de statut selon le temps de trajet (OK / Limite / Trop loin, seuils 20 / 35 min).

**Mode Retour Blois** — A → RDVs → Blois  
- Jusqu'à 7 RDVs intermédiaires dynamiques
- Destination fixe : Blois (bouton raccourci pour mettre Blois en départ)
- Comparaison trajet direct vs. avec détour(s)
- Détail incrémental du temps ajouté par chaque RDV
- **Suggestion d'ordre optimal** : si un autre ordre des RDVs fait gagner ≥ 1 min, l'extension le propose avec le gain estimé et le temps total de trajet optimal
- Bouton **Tout effacer** pour réinitialiser tous les champs en un clic
- Lien Google Maps avec tous les waypoints

**Mode Trajet multiple** — A → RDVs → B  
- Même fonctionnement que Retour Blois, mais la destination est un champ libre
- Boutons raccourcis Blois sur le départ et l'arrivée
- Jusqu'à 7 RDVs intermédiaires, breakdown et ordre optimal (avec temps total) inclus
- Bouton **Tout effacer** pour réinitialiser tous les champs en un clic

**Préférences**
- *Autocomplétion* : suggestions BAN (Base Adresse Nationale) filtrées sur le département 41
- *Mémoriser* : restaure automatiquement les derniers RDVs saisis (fonctionne pour les deux modes avec détours)

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
popup.js         — Toute la logique (~900 lignes)
theme-init.js    — Restauration du thème avant rendu (anti-FOUC, MV3-compatible)
icon.png         — Icône de l'extension
```
