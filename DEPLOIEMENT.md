# Mise en ligne de Note de frais

Architecture cible (gratuite ou presque pour démarrer) :

| Élément | Service | Dépôt |
|---|---|---|
| Base de données | MongoDB Atlas (cluster M0 gratuit) | — |
| Justificatifs | Cloudflare R2 (10 Go gratuits) | — |
| API (Express) | Render (Web Service) | `ndf-backend` |
| Site (React) | Vercel | `ndf-frontend` |

Ordre conseillé : 1 → 2 → 3 → 4 → 5. Chaque étape produit une valeur utilisée par la suivante.

---

## 1. MongoDB Atlas

1. Créer un compte sur https://www.mongodb.com/cloud/atlas et un cluster **M0 (Free)**, région Europe (ex. Paris ou Frankfurt).
2. *Database Access* : créer un utilisateur avec un mot de passe généré.
3. *Network Access* : ajouter `0.0.0.0/0` (Render n'a pas d'IP fixe sur l'offre gratuite).
4. *Connect → Drivers* : copier l'URL `mongodb+srv://...`, remplacer `<password>` et ajouter le nom de base `ndf` avant le `?` :
   `mongodb+srv://user:motdepasse@cluster0.xxxxx.mongodb.net/ndf?retryWrites=true&w=majority`

➡️ Valeur obtenue : `MONGO_URI`

## 2. Cloudflare R2 (justificatifs)

1. Créer un compte Cloudflare, aller dans **R2** et créer un bucket (ex. `ndf-justificatifs`). Le bucket reste **privé** : l'API sert les fichiers après vérification des droits.
2. *Manage R2 API Tokens* → créer un token **Object Read & Write** limité à ce bucket.
3. Noter l'Account ID (affiché dans R2).

➡️ Valeurs obtenues :
```
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=ndf-justificatifs
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

## 3. API sur Render

1. https://render.com → *New → Web Service* → connecter le dépôt GitHub `ndf-backend`.
2. Réglages :
   - Runtime : **Node**
   - Build command : `npm ci`
   - Start command : `npm start`
   - Health check path : `/api/health`
3. *Environment* : ajouter les variables suivantes.

| Variable | Valeur |
|---|---|
| `NODE_ENV` | `production` |
| `MONGO_URI` | étape 1 |
| `JWT_SECRET` | résultat de `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `CORS_ORIGIN` | URL Vercel de l'étape 4 (mettre une valeur provisoire, puis corriger) |
| `ANTHROPIC_API_KEY` | clé de https://console.anthropic.com |
| `STORAGE_DRIVER`, `S3_*` | étape 2 |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | fournisseur d'email (Brevo, Resend, Gmail avec mot de passe d'application…) |

Ne pas définir `PORT` : Render le fournit.

Au démarrage, le serveur vérifie la configuration (`config/checkEnv.js`) et refuse de démarrer si une valeur obligatoire manque ou si `JWT_SECRET` est trop faible. Lire les logs Render en cas d'échec.

➡️ Valeur obtenue : l'URL de l'API, ex. `https://ndf-backend.onrender.com`. Tester `https://ndf-backend.onrender.com/api/health`, qui doit renvoyer `{"ok":true}`.

> Offre gratuite : le service s'endort après 15 min d'inactivité, et la première requête suivante prend environ 30 s. L'offre payante (~7 $/mois) supprime cette mise en veille.

## 4. Site sur Vercel

1. https://vercel.com → *Add New → Project* → importer le dépôt `ndf-frontend`.
2. Framework : **Vite** (détecté automatiquement). Build : `npm run build`, dossier de sortie : `dist`.
3. *Environment Variables* :
   `VITE_API_URL` = `https://ndf-backend.onrender.com/api` (URL de l'étape 3, suivie de `/api`)
4. Déployer. Le fichier `vercel.json` redirige toutes les URLs vers l'application, ce qui permet de recharger une page comme `/dashboard`.

➡️ Valeur obtenue : l'URL du site, ex. `https://ndf-frontend.vercel.app`

## 5. Relier les deux

Sur Render, mettre `CORS_ORIGIN` = URL exacte du site Vercel (sans slash final), puis redéployer. Pour autoriser plusieurs domaines, les séparer par des virgules.

Ouvrir le site, créer un compte, puis tester une note avec justificatif et un scan IA.

---

## Sécurité déjà en place

- En-têtes de sécurité HTTP (`helmet`)
- Limites de requêtes par IP : 300 / 15 min sur l'API, 20 / 15 min sur connexion et inscription, 30 scans IA / heure
- CORS limité aux domaines déclarés
- Justificatifs dans un bucket privé, servis uniquement aux personnes autorisées
- Vérification de la configuration au démarrage

## À prévoir si de vraies personnes utilisent le service (RGPD)

- Pages « Mentions légales » et « Politique de confidentialité »
- Possibilité de supprimer son compte et ses données
- Domaine personnalisé (optionnel) : à configurer dans Vercel (site) et Render (API)
