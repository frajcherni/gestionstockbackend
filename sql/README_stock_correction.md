# Correction stock MAGAZIN — `stock_depot` uniquement

## Principe

| Niveau | Rôle |
|--------|------|
| **`stock_depot.qte`** (dépôt magazin) | Stock réel du magazin — **source de vérité** pour ce dépôt |
| **`articles.qte`** | Somme de tous les `stock_depot` (recalcul après chaque opération magazin) |
| **`journal_sortie_articles`** | Historique des sorties (filtre par date) — **uniquement** `depot_id` magazin |

## Inventaire : même article plusieurs lignes

À la création / mise à jour, si le **même `article_id`** apparaît plusieurs fois :

- **`qte_reel` est additionnée** pour `stock_depot` du dépôt inventorié
- Chaque ligne reste enregistrée dans `inventaire_items` (détail)
- Le stock magazin = **SUM(qte_reel)** par article

## Ordre des scripts

| # | Fichier | Action |
|---|---------|--------|
| 0 | `00_check_ventes_sans_depot.sql` | **Lecture seule** — ventes sans `depot_id` |
| 1 | `01_backfill_journal_historique.sql` | Remplir le journal (magazin) |
| **4** | **`04_magazin_init_inventaire_then_sorties.sql`** | **Recommandé** : inventaire **`INVENTAIRE-2025-089`** (SUM) → stock magazin → − **toutes** sorties journal (sans filtre date) |
| 2 | `02_sync_stock_from_inventaire_magazin.sql` | Seulement poser inventaire sur `stock_depot` |
| 3 | `03_apply_sorties_to_stock_magazin.sql` | Seulement déduire sorties journal magazin |

## Formule (magazin)

```
stock_depot[article, magazin] =
  SUM(qte_reel) dans inventaire numero INVENTAIRE-2025-089
  − SUM(quantite journal_sortie WHERE depot_id = magazin)  -- historique complet
  (quantités négatives autorisées, ex. −43)
```

Ne pas choisir l'inventaire par `date_inventaire` (dates parfois corrigées après coup).

## Ventes sans dépôt

Exécuter `00_check_ventes_sans_depot.sql` pour les lister.  
Corriger : **`05_fix_depot_null_to_magazin_id1.sql`** (met `depot_id = 1` sur les ventes comptoir NULL).  
Puis refaire le backfill journal + script `04` si vous recalculez le stock.

Les **nouvelles** ventes comptoir sans `depot_id` utilisent automatiquement le dépôt **id = 1** (magazin) côté backend.

API backfill : `POST /api/journal-sortie/backfill-historique` (magazin seulement).
