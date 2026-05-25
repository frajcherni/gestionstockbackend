# Où `depot_id` est requis pour réduire le stock (système actuel)

## Deux mécanismes dans le code

| Mécanisme | Effet sur magazin |
|-----------|-------------------|
| **`updateDepotStock(depot_id, -qte)`** | Modifie **`stock_depot.qte`** + recalcule `articles.qte` |
| **`article.qte -= qte`** (sans dépôt) | Modifie seulement **`articles.qte`** (souvent pas `qte_physique`) — **pas `stock_depot` magazin** |

Pour le magazin, il faut **`depot_id` renseigné** pour que `updateDepotStock` cible le bon `stock_depot`.

---

## Documents VENTE qui peuvent SORTIR du stock

### 1. Vente comptoir — `vente_comptoire.depot_id`

| Action | Réduit stock ? | Condition |
|--------|----------------|-----------|
| **Create** | Oui | Chaque ligne `quantite` |
| **Update** (articles modifiés) | Oui | Restore ancien + retire nouveau |
| **Delete** | Restaure (+) | |

- **Avec `depot_id`** → `stock_depot` + `articles.qte`
- **Sans `depot_id`** → seulement `article.qte` / `qte_physique` (pas magazin `stock_depot`)

---

### 2. Bon de commande client — `bon_commande_clients.depot_id`

| Action | Réduit stock ? | Condition |
|--------|----------------|-----------|
| **Create** | Oui | Seulement si **`quantiteLivree` > 0** sur la ligne |
| **Update** | Oui | Delta sur `quantiteLivree` |
| **Delete** | Restaure | Si `quantiteLivree` > 0 |

- Pas de livraison sur le BC seul : utilise `quantiteLivree` comme sortie immédiate.
- **Avec `depot_id`** → `stock_depot`
- **Sans `depot_id`** → `article.qte` global seulement

---

### 3. Bon de livraison — `bon_livraisons.depot_id`

| Action | Réduit stock ? | Condition |
|--------|----------------|-----------|
| **Create** | Oui | Si **`skipStockUpdate` ≠ true** |
| **Update** | Oui | Si statut Livré / Partiellement livré |
| **Delete** | Restaure | `stock_depot` si `bon.depot` |

**Pas de réduction si :**

- `skipStockUpdate: true` (ex. BL créé depuis **vente comptoir** — stock déjà sorti sur la VC)
- `quantite` / delta = 0

**Lié à un BC :** réduit le **delta** de livraison (`nouvelle quantiteLivree - déjà livré`), pas la quantité commandée entière.

- **Avec `depot_id`** → `stock_depot` (souvent sans `qte_physique` en fallback)
- **Sans `depot_id`** → `article.qte` seulement

---

### 4. Facture client — `factures_client.depot_id`

| Action | Réduit stock ? | Condition |
|--------|----------------|-----------|
| **Create** | Parfois | Voir ci-dessous |
| **Update / Delete / Annuler** | Parfois | Si pas liée VC/BL |

**Réduit le stock seulement si TOUTES ces conditions :**

```text
!bonLivraison_id
!venteComptoire_id
facture.depot_id IS NOT NULL
```

| Cas | Stock réduit sur facture ? |
|-----|---------------------------|
| Facture **directe** (seule) | Oui → `stock_depot` si `depot_id` |
| Facture depuis **BC** | Oui → part `facturé - déjà livré` sur BC |
| Facture depuis **BL** | **Non** (déjà sorti au BL) |
| Facture depuis **vente comptoir** | **Non** (déjà sorti à la VC) |

**Sans `depot_id`** → **aucune** réduction via `updateDepotStock` (même facture directe).

---

### 5. Devis — pas de sortie stock

Le devis **ne réduit pas** le stock (aucun `updateDepotStock` dans `DevisController`).

---

## ACHAT / ENTRÉES (augmentent le stock — autre logique)

| Document | Table | `depot_id` | Effet |
|----------|-------|------------|--------|
| Bon de réception | `bons_reception` / lignes | Oui | **+** stock (`updateDepotStock` +qty) |
| Inventaire | nom dépôt dans `inventaires.depot` | Dépôt inventorié | **Fixe** `stock_depot` = SUM(`qte_reel`) |
| Transfert | entre dépôts | source + destination | Déplace entre `stock_depot` |

Ce ne sont pas des « ventes », mais ils modifient aussi `stock_depot` si `depot_id` est présent.

---

## Chaînes à ne pas compter deux fois (journal / correction)

```text
Vente comptoir  ──sortie──►  (skipStockUpdate sur BL lié)
       │
       └──► BL lié VC     ──pas de 2e sortie──

BC + quantiteLivree  ──sortie──►  (attention si BL ensuite sur même BC)
       │
       └──► BL depuis BC  ──sortie delta seulement──

BL  ──sortie──►  Facture depuis BL  ──pas de 2e sortie──
```

Pour le **journal magazin** et le script **04**, ne compter qu’**un seul** maillon par quantité (comme dans `01_backfill`).

---

## Tables à corriger si `depot_id` NULL → 1 (magazin)

Pour que le **magazin `stock_depot`** et le **journal** reflètent l’historique :

1. `vente_comptoire`
2. `bon_livraisons` (sauf BL avec `skipStockUpdate` déjà géré côté stock, mais `depot_id` utile pour le journal)
3. `bon_commande_clients`
4. `factures_client` (surtout factures **directes** ou **BC** sans BL)

Script : **`05_fix_depot_null_to_magazin_id1.sql`** (met à jour les 4 tables).

Puis : backfill journal + `04_magazin_init_inventaire_then_sorties.sql`.

---

## Résumé une phrase

**`depot_id` magazin est obligatoire partout où vous voulez que la sortie passe par `stock_depot` ; sans lui, le code ne touche souvent que `articles.qte` global, et la facture / BL liée à une autre pièce ne sort pas deux fois.**
