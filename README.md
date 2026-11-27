# FreshBox voor Homey

Je HelloFresh-box in je Homey Pro: bezorgdag, tijdvak, recepten, overgeslagen weken, en "zelf in huis" naar je Bring!-lijst.

> Onofficiële app, niet gemaakt door HelloFresh. HelloFresh® is een merk van HelloFresh SE.

## Wat zit erin

- **Apparaat "HelloFresh":** status, volgende box, tijdvak, dagen tot de box, volgende week, aantal recepten, "box staat buiten", knoppen *Box is binnen* en *Nu bijwerken*
- **Flowkaarten**
  - *Als:* bezorging is morgen · bezorgdag is begonnen · tijdvak begint over x minuten · box is onderweg · box is bezorgd · status is veranderd · er is een week overgeslagen · nieuwe recepten bekend · menu kiezen sluit over x uur
  - *En:* vandaag is bezorgdag · deze/volgende week is overgeslagen · het is binnen het tijdvak · bezorging is binnen x dagen · box staat buiten · box is vandaag bezorgd
  - *Dan:* gegevens nu verversen · zet status op onderweg/bezorgd/gepland · box is binnen gezet · maak receptentekst · zet "zelf in huis" op Bring!
- **Negen widgets:** deze week, volgende week, levertijd live, aftellen, menu kiezen, box staat buiten, zelf in huis (met Bring!-knop), komende weken en een statusbalk
- **Bring!:** zodra de recepten van je volgende box vastliggen, zet FreshBox wat je zelf in huis moet hebben op je Bring!-lijst. Dit gaat via de app *Bring! Boodschappenlijst* op dezelfde Homey, dus je logt niet nog een keer in. Producten die al op de lijst staan of die je altijd in huis hebt (instelbaar, standaard zout en peper) worden overgeslagen.

## Installeren (via GitHub, zonder eigen computer)

1. Zet in deze repository een secret **HOMEY_PAT**: **Settings → Secrets and variables → Actions → New repository secret**. Je token vind je op tools.developer.homey.app (rechtsboven op je naam → **Personal Access Token**, begint met `pat-`).
2. Ga naar **Actions → Publiceren naar Homey (test) → Run workflow**.
3. Als hij klaar is (groen vinkje), open je de link uit de stap "Klaar" en zet je de app op **Test**.
4. Installeer de testversie op je Homey Pro en voeg toe: **Apparaten → + → FreshBox → HelloFresh-account**.

## Inloggen

Log in met hetzelfde **e-mailadres en wachtwoord** als in de HelloFresh-app. Je wachtwoord blijft alleen op je eigen Homey en wordt gebruikt om opnieuw in te loggen als HelloFresh je uitlogt.

Blokkeert HelloFresh het inloggen vanaf Homey (je ziet dan een melding over een beveiliging)? Kies **Inloggen via de website**. Je maakt dan één keer een bladwijzer in Safari, logt in op hellofresh.nl, tikt op de bladwijzer en plakt de FreshBox-code in Homey. Daarna ververst FreshBox zelf.

Geen wachtwoord (bijvoorbeeld inloggen met Google of Apple)? Kies dan **Inloggen met een link in je mail**: houd de knop in de mail ingedrukt, kies **Kopieer link** en plak hem in Homey.

Verloopt het inloggen toch, dan wordt het apparaat grijs. Kies dan **Herstellen** en log opnieuw in.

## Samen met Mail Hook

HelloFresh laat via deze verbinding waarschijnlijk niet zien dat de box onderweg of bezorgd is. Je bezorgmails doen dat wel. Met de app Mail Hook kun je de status doorgeven:

- Mail "Je HelloFresh Box is er bijna" → *Zet status op Onderweg*
- Mail "Je HelloFresh Box is bezorgd" → *Zet status op Bezorgd*

Dan werken "Box is onderweg", "Box is bezorgd", de levertijd-widget en "Box staat buiten" ook.

Voorbeeld voor het rolluik:
- Als *Bezorgdag is begonnen* · En *Deze week is niet overgeslagen* · Dan rolluik open
- Als *Box is bezorgd* · Dan rolluik dicht

## Belangrijk om te weten

- De app praat met HelloFresh op dezelfde manier als hun website. Dat is niet officieel: als HelloFresh iets verandert, kan de app tijdelijk stoppen met werken.
- Het tijdvak en "zelf in huis" staan niet in elk antwoord van HelloFresh. Klopt iets niet? Open **Instellingen → Apps → FreshBox → Configureren**, tik op **Gegevens ophalen** en stuur de tekst door. Namen, adressen, e-mail en tokens worden daar weggelaten.
- Standaard werkt de app elk uur bij, en op de bezorgdag elk kwartier. Dat kun je aanpassen bij het apparaat.
- "Bezorgdag is begonnen" gaat standaard om 07:00 af en "Bezorging is morgen" om 19:00. Ook dat kun je aanpassen.

## Bedankt

De manier van inloggen en ophalen is gebaseerd op [pyhellofresh](https://github.com/pantherale0/pyhellofresh) van Alberto Montes (MIT-licentie) en op hoe [mcp-hellofresh](https://github.com/JulienA/mcp-hellofresh) inlogt en ververst.
