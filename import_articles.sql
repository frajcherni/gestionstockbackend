-- SQL Import Script for 11108 articles

COPY articles (
    id, reference, designation, pua_ttc, pua_ht, puv_ht, tva, puv_ttc, 
    type, qte, qte_virtual, nom, taux_fodec, image, sous_categorie_id,
    on_website, is_offre, is_top_seller, is_new_arrival, website_description,
    website_images, website_order
  ) FROM STDIN WITH CSV HEADER;

-- Or use this alternative approach:
-- \copy articles FROM 'articles_processed.csv' WITH CSV HEADER;
