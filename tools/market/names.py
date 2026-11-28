"""Noms français des produits scellés : « <Type FR> – <Série FR> (<détail FR>) », ou « <Type FR> <détail FR> » pour les
produits sans série (extensions « fourre-tout » de Cardmarket), « <Type FR> – <série japonaise> » pour les produits
japonais (leurs séries n'ont pas de nom français : le nom anglais de Cardmarket est gardé tel quel).

Le type vient d'une table de formules anglaises (la plus longue l'emporte, en fin de nom ou devant « : », « ( »,
« [ », « - »), la série de TCGdex FR (fautes corrigées), le détail est traduit : noms des Pokémon (PokéAPI), formes
(Méga-, d'Alola…), suffixes de cartes (-EX, -GX, V…), saisons, couleurs, mentions (vide, version EU, N cartes…).
Produits japonais : seuls les noms de Pokémon, les formules entières (Pikachu au poncho, gammes connues) et le type
d'énergie sont traduits, jamais mot à mot (« Collector's Figure » reste tel quel, pas « de collection Figure »).
Le nom n'est jamais vide. Relecture : python tools/build_market.py --report (.cache/mk/report/sealed-top300.md).
"""
import re

from .util import straight

# Noms de séries : fautes de TCGdex FR et noms officiels absents (vérifiés sur les logos et Poképédia).
SET_FIX = {
    "bw8": "Tempête Plasma", "bw6": "Dragons Exaltés", "dp4": "Duels au Sommet", "sm7.5": "Majesté des Dragons",
    "pl2": "Rivaux Émergents", "swsh5": "Styles de Combat", "col1": "L'Appel des Légendes",
    "ex12": "EX Créateurs de Légendes", "ex2": "EX Tempête de Sable", "ecard1": "Expédition",
    "base4": "Set de Base 2", "lc": "Collection Légendaire", "bw11": "Trésors Légendaires", "pl4": "Arceus",
    "ex7": "EX Team Rocket Returns", "pop5": "POP Série 5", "pop6": "POP Série 6", "pop8": "POP Série 8",
    "basep": "Promo Wizards", "svp": "Promo SV", "mep": "Promo ME", "xya": "Carte alternative A Jaune",
}

# ---------- types : (formule anglaise, libellé français, types de produit où elle vaut) ----------
_N = r"(\d{1,2})"  # nombre d'unités d'un carton (jamais « 151 »)
TYPES = [
    # cartons et présentoirs (produits pour revendeurs)
    (rf"{_N}\s*Enhanced Booster Box Case", "Carton de {0} displays améliorés", "case"),
    (rf"{_N}\s*Booster Box Case", "Carton de {0} displays", "case"),
    (r"(?:Enhanced )?Booster Box Case", "Carton de displays", "case"),
    (rf"{_N}\s*Elite Trainer Box Case", "Carton de {0} Coffrets Dresseur d'Élite", "case"),
    (r"Elite Trainer Box Case", "Carton de Coffrets Dresseur d'Élite", "case"),
    (rf"{_N}\s*Sleeved Booster Case", "Carton de {0} boosters sleeved", "case"),
    (r"Sleeved Booster Case", "Carton de boosters sleeved", "case"),
    (r"Booster Bundle (?:Display|Case)", "Présentoir de bundles", "case"),
    (r"Build (?:&|and) Battle (?:Box|Stadium) Display", "Présentoir de Boîtiers Stratégies et Combats", "case"),
    (rf"Mini Tins?:?\s*{_N}-Tin Display(?: Box)?", "Présentoir de {0} Mini Tins", "case"),
    (r"Mini Tins? Display(?: Box)?", "Présentoir de Mini Tins", "case"),
    (r"Stacking Tins? Display(?: Box)?", "Présentoir de Pokébox empilables", "case"),
    (rf"{_N}-Tin Display(?: Box)?", "Présentoir de {0} Pokébox", "case"),
    (r"Tins? Display(?: Box)?", "Présentoir de Pokébox", "case"),
    (r"Tech Sticker Collection Display", "Présentoir de coffrets stickers", "case"),
    (r"Premium Tournament Collection(?: Box)? Display", "Présentoir de coffrets Premium Tournoi", "case"),
    (r"Pin Collection Display", "Présentoir de coffrets pin's", "case"),
    (r"WCD (\d{4}) Display", "Présentoir de decks des Championnats du monde {0}", "case"),
    (r"Theme Decks? Display", "Présentoir de decks à thème", "case"),
    (r"Battle Decks? Display", "Présentoir de decks de combat", "case"),
    (r"(?:\d-Pack )?Blister Display", "Présentoir de blisters", "case"),
    (r"Collection Display", "Présentoir de coffrets", "case"),
    (r"Display Case|Case|Display", "Carton", "case"),
    # coffrets dresseur d'élite
    (r"Pok[eé]mon Center Elite Trainer Box Plus", "Coffret Dresseur d'Élite Plus Pokémon Center", "etb"),
    (r"Elite Trainer Box Plus", "Coffret Dresseur d'Élite Plus", "etb"),
    (r"Pok[eé]mon Center Elite Trainer Box", "Coffret Dresseur d'Élite Pokémon Center", "etb"),
    (r"Elite Trainer Box", "Coffret Dresseur d'Élite", "etb coffret"),
    # displays
    (r"Enhanced Booster (?:Box|Display)", "Display amélioré", "box"),
    (r"Deluxe Booster (?:Box|Display)", "Display deluxe", "box"),
    (r"Limited Booster Box Set", "Display édition limitée", "box"),
    (r"Booster Box \(\d+ Boosters?\)", "Demi-display", "halfbox"),
    (r"Half Booster Box", "Demi-display", "halfbox"),
    (r"Booster (?:Box|Display)(?: Box)?", "Display", "box halfbox"),
    (r"Bonus Pack Display", "Display de bonus packs", "box"),
    (r"Display", "Display", "box"),
    # bundles
    (r"Booster Bundle Pok[eé]mon Center Version", "Bundle Pokémon Center", "bundle"),
    (r"Battle Deck (?:&|and) (\d) Booster Bundle", "Deck de combat et {0} boosters", "bundle"),
    (r"Booster Bundle", "Bundle", "bundle coffret"),
    # avant-premières
    (r"Build (?:&|and) Battle Stadium(?: Box)?", "Stade Stratégies et Combats", "prerelease"),
    (r"Build (?:&|and) Battle Box", "Boîtier Stratégies et Combats", "prerelease"),
    (r"Prerelease (?:Pack|Kit|Box)", "Kit d'avant-première", "prerelease"),
    # pokébox
    (rf"{_N}-Pack Mini Tins?(?: Bundle)?", "Lot de {0} Mini Tins", "tin"),
    (r"Mini Tins? Bundle", "Lot de Mini Tins", "tin"),
    (r"Mini Tins?", "Mini Tin", "tin"),
    (r"Pencil Case", "Trousse métal", "tin"),
    (r"Stacking Tins?", "Pokébox empilable", "tin"),
    (r"Collector'?s Tins?", "Pokébox de collection", "tin"),
    (r"Lunch Box", "Boîte à goûter", "tin"),
    (r"Tins?", "Pokébox", "tin coffret"),
    # blisters
    (r"Premium Checklane Blister", "Blister premium", "blister"),
    (r"Checklane Blister", "Blister 1 booster", "blister"),
    (r"1-Pack Blister", "Blister 1 booster", "blister"),
    (r"2-Pack Blister", "Duopack", "blister"),
    (r"3-Pack Blister", "Tripack", "blister"),
    (rf"{_N}-Pack Blister", "Blister {0} boosters", "blister"),
    (r"Stage (\d) Blister", "Blister Stage {0}", "blister"),
    (r"Blister(?: Pack)?", "Blister", "blister"),
    # boosters
    (r"Sleeved Booster", "Booster sleeved", "booster"),
    (r"Deluxe Booster", "Booster deluxe", "booster"),
    (rf"Sampling Pack \({_N} Cards?\)", "Sampling pack ({0} cartes)", "booster"),
    (rf"Fun Pack \({_N} Cards?\)", "Fun pack ({0} cartes)", "booster"),
    (rf"Dollar Tree Booster \({_N} Cards?\)", "Booster Dollar Tree ({0} cartes)", "booster"),
    (rf"Booster \({_N} Cards?\)", "Booster ({0} cartes)", "booster"),
    (r"Promo Card Pack|Promo Pack", "Pack de cartes promo", "booster"),
    (r"Trainer'?s Pack", "Pack du Dresseur", "booster"),
    (r"Bonus Pack", "Bonus pack", "booster"),
    (r"Expansion Pack Booster|Booster(?: Pack)?", "Booster", "booster"),
    # decks
    (r"League Battle Decks?", "Deck Combat de Ligue", "deck coffret"),
    (r"Legendary Battle Decks?", "Deck de combat légendaire", "deck"),
    (r"SP Deck Kit", "Kit de decks SP", "deck kit"),
    (r"High[- ]Class Deck Double Box", "Coffret de 2 decks High Class", "deck coffret"),
    (r"High[- ]Class Decks?", "Deck High Class", "deck"),
    (r"Master Trainer Deck", "Deck Maître Dresseur", "deck"),
    (r"Deluxe Battle Deck", "Deck de combat deluxe", "deck"),
    (r"Battle Arena Decks?", "Decks Arène de combat", "deck"),
    (r"Battle Decks?", "Deck de combat", "deck bundle"),
    (r"Theme Decks?", "Deck à thème", "deck"),
    (r"Start(?:er)? Decks?", "Deck de démarrage", "deck"),
    (r"(\d)-Player (?:CD-ROM )?Starter Set", "Set de démarrage {0} joueurs", "deck"),
    (r"Triple Starter Set", "Set de démarrage triple", "deck coffret"),
    (r"Starter Set", "Set de démarrage", "deck coffret"),
    (r"(?:WCD|World Championships? Decks?) (\d{4})", "Deck des Championnats du monde {0}", "deck"),
    (r"Battle Academy", "Académie de Combat", "deck coffret"),
    (r"Decks?", "Deck", "deck"),
    # kits
    (r"Trainer Kit", "Kit du dresseur", "kit deck coffret"),  # comme les séries (« SM Kit du dresseur »)
    (r"Battle Stadium", "Stade de combat", "kit"),
    # coffrets
    (r"Ultra[- ]Premium Collection", "Coffret Ultra-Premium", "coffret"),
    (r"Super[- ]Premium Collection", "Coffret Super-Premium", "coffret"),
    (r"Premium Collection Bundle", "Lot de coffrets Premium", "coffret"),
    (r"Premium Figure Collection", "Coffret figurine premium", "coffret"),
    (r"Premium Tournament Collection(?: Box)? Bundle", "Lot de coffrets Premium Tournoi", "coffret"),
    (r"Premium Tournament Collection(?: Box)?", "Coffret Premium Tournoi", "coffret"),
    (r"Premium Trainer'?s (\w+) Collection", "Coffret Premium du Dresseur {0}", "coffret"),
    (r"Premier Deck Holder Collection", "Coffret range-deck premium", "coffret"),
    (r"Premium Collection", "Coffret Premium", "coffret"),
    (r"Special Illustration Collection", "Coffret illustration spéciale", "coffret"),
    (r"Illustration Collection", "Coffret illustration", "coffret"),
    (r"Legendary Collection", "Coffret légendaire", "coffret"),
    (r"Deluxe Pin Collection", "Coffret pin's deluxe", "coffret"),
    (r"Special Pin Collection|Pin Collection", "Coffret pin's", "coffret"),
    (r"Figure Collection", "Coffret figurine", "coffret"),
    (r"Poster Collection|Poster Box|Poster Pack", "Coffret poster", "coffret"),
    (r"Trainer Card Collection", "Coffret carte Dresseur", "coffret"),
    (r"Special Case File|Case File", "Dossier spécial", "coffret blister"),
    (rf"{_N}-Pack (?:Pok[eé]mon Card )?Bundle", "Lot de {0}", "coffret"),
    (r"Adventures? Chest", "Coffre d'aventure", "coffret"),
    (r"Collector'?s? Bundle", "Lot de collection", "coffret"),
    (r"Collector'?s Album(?: Box)?", "Album de collection", "coffret"),
    (r"Binder Collection", "Coffret classeur", "coffret"),
    (r"Card File Set", "Coffret classeur", "coffret"),
    (r"Tech Sticker Collection", "Coffret stickers", "coffret blister"),
    (r"Special Collection|Special Box", "Coffret spécial", "coffret"),
    (r"Collector'?s? Chest", "Coffre de collection", "coffret tin"),
    (r"Precious Collector Box", "Coffret Precious Collector", "coffret"),
    (r"Collector'?s? Box", "Coffret de collection", "coffret"),
    (r"Holiday Calendar", "Calendrier des fêtes", "coffret"),
    (r"Advent (?:Countdown )?Calendar", "Calendrier de l'Avent", "coffret"),
    (r"Game Box", "Coffret de jeu", "coffret"),
    (r"Gift Box", "Coffret cadeau", "coffret"),
    (r"Player'?s Pack", "Pack du Joueur", "coffret"),
    (r"Value Box|Collection Box|Card Box|Collection|Box", "Coffret", "coffret"),
]
DEFAULT = {"box": "Display", "halfbox": "Demi-display", "etb": "Coffret Dresseur d'Élite", "bundle": "Bundle",
           "prerelease": "Boîtier Stratégies et Combats", "tin": "Pokébox", "blister": "Blister", "booster": "Booster",
           "deck": "Deck", "kit": "Kit du dresseur", "coffret": "Coffret", "case": "Carton"}
# une formule de type se trouve en fin de nom, ou devant « : », « ( », « [ », « - » (éventuellement suivie d'un nombre)
_END = r"(?=\s*(?:\d{1,4}\s*)?(?:$|[:(\[]|-\s|–))"
_TYPES = [(re.compile(r"(?<![\w'])(?:" + rx + r")(?![\w'])" + _END, re.I), fr, set(kinds.split()))
          for rx, fr, kinds in TYPES]
SET_LIKE = {"box", "halfbox", "booster", "case", "bundle"}  # produits japonais nommés d'après leur série

# ---------- mentions et mots courants ----------
FLAGS = [  # (formule, mention française) ; retirées du détail et ajoutées entre parenthèses
    (r"\(\s*(?:EU|European)[ -]?Version\s*\)|\bEU[ -]Version\b", "version EU"),
    (r"\(\s*(?:US|NA)[ -]?Version\s*\)|\bUS[ -]Version\b", "version US"),
    (r"\(\s*UK[ -]?Version\s*\)", "version UK"),
    (r"\(\s*North American\s*\)", "version nord-américaine"),
    (r"\(\s*European\s*\)", "version européenne"),
    (r"\(\s*International\s*\)", "version internationale"),
    (r"\(\s*Asian?\s*\)", "version asiatique"),
    (r"\bFR\b", "version française"),
    (r"\bEmpty\b", "vide"),
    (r"\bSealed\b", ""),
]
_FLAGS = [(re.compile(rx, re.I), fr) for rx, fr in FLAGS]
LINES = [  # gammes et époques, formules entières (avant les noms de Pokémon et les mots)
    (r"\bFire ?Red (?:and|&) Leaf ?Green\b", "Rouge Feu et Vert Feuille"),
    (r"\bLegendary Dragons of Unova\b", "Dragons légendaires d'Unys"), (r"\bOn the Case\b", "mène l'enquête"),
    (r"\bBlack Bolt\b", "Foudre Noire"), (r"\bWhite Flare\b", "Flamme Blanche"),
    (r"\bThree Pins?\b", "3 pin's"), (r"\bMega Evolution Products\b", "Méga-Évolution"),
    (r"\bDiamond (?:and|&) Pearl\b", "Diamant et Perle"), (r"\bBlack (?:and|&) White\b", "Noir et Blanc"),
    (r"\bSun (?:and|&) Moon\b", "Soleil et Lune"), (r"\bSword (?:and|&) Shield\b", "Épée et Bouclier"),
    (r"\bScarlet (?:and|&) Violet\b", "Écarlate et Violet"), (r"\bMega Evolution\b", "Méga-Évolution"),
    (r"\bRed (?:and|&) Blue\b", "Rouge et Bleu"), (r"\bGold (?:and|&) Silver\b", "Or et Argent"),
    (r"\b(?:Mythical|Fabulous) Pok[eé]mon\b", "Pokémon fabuleux"), (r"\bLegendary Pok[eé]mon\b", "Pokémon légendaires"),
    (r"\bEeveelutions?\b", "Évolitions"), (r"\bPok[eé]mon Demo Game\b", "jeu de démonstration Pokémon"),
    (r"\bDemo Game\b", "jeu de démonstration"), (r"\bUnova\b", "Unys"),
    (r"\b(Kanto|Johto|Hoenn|Sinnoh|Unys|Kalos|Alola|Galar|Paldea) Starters?\b", r"Pokémon de départ de \1"),
    (r"\bUltra Beasts?\b", "Ultra-Chimères"), (r"\bMasks of Ogerpon\b", "Masques d'Ogerpon"),
]
WORD_LINES = [  # mots isolés : produits internationaux seulement (mot à mot, faux dans un nom japonais)
    (r"\bFirst Partners?\b", "Pokémon de départ"),
    (r"\bStarters?\b", "Pokémon de départ"), (r"\b(\d+)-Pack\b", r"lot de \1"),
    (r"\bIllustrated Booklet\b", "livret illustré"), (r"\bDeck Holder\b", "range-deck"), (r"\bEraser\b", "gomme"),
    (r"\bAccessory Pouch\b", "pochette d'accessoires"), (r"\bGeneric\s+", ""),
]
_LINES = [(re.compile(rx, re.I), fr) for rx, fr in LINES]
_WORD_LINES = [(re.compile(rx, re.I), fr) for rx, fr in WORD_LINES]
WORDS = [  # traductions mot à mot du détail (après les noms de Pokémon)
    (r"\bwith\b", "avec"), (r"\band\b", "et"), (r"\s&\s", " et "), (r"\bvs\.?(?=\s)", "contre"),
    (r"\bSpring\b", "printemps"), (r"\bFall\b|\bAutumn\b", "automne"), (r"\bSummer\b", "été"),
    (r"\bWinter\b", "hiver"), (r"\bHoliday\b", "fêtes"), (r"\bBack to School\b", "rentrée"),
    (r"\bSeries\b", "série"), (r"\bVersion\b", "version"), (r"\bSpecial\b", "spécial"),
    (r"\bCollector'?s\b", "de collection"), (r"\bPromos?\b", "promo"), (r"\bExclusive\b", "exclusif"),
    (r"\bIllustration\b", "illustration"), (r"\bShiny\b", "chromatique"),
    (r"\(\s*(\d+) Packs?\s*\)", r"(\1 boosters)"), (r"\(\s*(\d+) Cards?\s*\)", r"(\1 cartes)"),
]
_WORDS = [(re.compile(rx, re.I), fr) for rx, fr in WORDS]
_JA_WORDS = [(re.compile(rx, re.I), fr) for rx, fr in WORDS[1:4]]  # produits japonais : « and », « & », « vs » seulement
ENERGY = {"Fire": "Feu", "Water": "Eau", "Grass": "Plante", "Lightning": "Électrique", "Psychic": "Psy",
          "Fighting": "Combat", "Darkness": "Obscurité", "Metal": "Métal", "Fairy": "Fée", "Colorless": "Incolore"}
# réécritures de noms anglais japonais à la structure inhabituelle (avant l'analyse)
JA_REWRITE = [(re.compile(r"^MEGA Starter Set (.+)$"), r"MEGA: \1 Starter Set")]
COLORS = {"red": "rouge", "blue": "bleu", "green": "vert", "yellow": "jaune", "black": "noir", "white": "blanc",
          "pink": "rose", "purple": "violet", "orange": "orange", "gray": "gris", "grey": "gris", "gold": "or",
          "silver": "argent"}
# mots anglais de type qui ne doivent pas rester dans le détail (avec majuscule : les traductions sont en minuscules)
LEFTOVER = re.compile(r"(?<![\w'])(?:Collections?|Boxes|Box|Tins?|Packs?|Blisters?|Bundle|Display|Case|"
                      r"Elite Trainer|Booster)(?![\w'])")
SOLO = {"Day": "jour", "Night": "nuit", "Legendary": "légendaire", "Mythical": "fabuleux"}  # mot seul du détail
# lignes sans information (« Pokémon TCG: Holiday Calendar 2023 »)
EMPTY_LINE = re.compile(r"^(?:Pok[eé]mon(?: TCG| Trading Card Game)?|TCG)$", re.I)
BALLS = {"Repeat Ball": "Bis Ball", "Quick Ball": "Rapide Ball", "Dusk Ball": "Sombre Ball", "Luxury Ball": "Luxe Ball",
         "Premier Ball": "Honor Ball", "Timer Ball": "Chrono Ball", "Heal Ball": "Soin Ball", "Net Ball": "Filet Ball",
         "Dive Ball": "Scuba Ball", "Nest Ball": "Faiblo Ball", "Friend Ball": "Copain Ball", "Fast Ball": "Speed Ball",
         "Level Ball": "Niveau Ball", "Lure Ball": "Appât Ball", "Heavy Ball": "Masse Ball", "Moon Ball": "Lune Ball",
         "Cherish Ball": "Mémoire Ball", "Ultra Ball": "Hyper Ball", "Great Ball": "Super Ball"}


class Namer:
    def __init__(self, species, set_names):
        """species = {anglais: français} (PokéAPI) ; set_names = {sid: (fr, en)}."""
        self.set_names = set_names
        sp = {straight(k): v for k, v in species.items() if k and v}  # « Sirfetch’d » -> « Sirfetch'd »
        # formes et noms composés (avant les espèces seules)
        forms = {
            "Black Kyurem": "Kyurem Noir", "White Kyurem": "Kyurem Blanc",
            "Dusk Mane Necrozma": "Necrozma Crinière du Couchant", "Dawn Wings Necrozma": "Necrozma Ailes de l'Aurore",
            "Ultra Necrozma": "Ultra-Necrozma", "Ice Rider Calyrex": "Sylveroy Cavalier du Froid",
            "Shadow Rider Calyrex": "Sylveroy Cavalier d'Effroi", "Single Strike Urshifu": "Shifours Poing Final",
            "Rapid Strike Urshifu": "Shifours Mille Poings", "Single Strike": "Poing Final", "Rapid Strike": "Mille Poings",
            "Pikachu Libre": "Pikachu Catcheur", "Detective Pikachu": "Détective Pikachu",
            "Team Galactic": "Team Galaxie", "Professor Oak": "Professeur Chen",
            **BALLS,
        }
        self.sp = {**sp, **forms}
        self.fr_species = set(sp.values())
        # mots après lesquels « EX », « GX », « ex » est un suffixe de carte (Dracaufeu-EX ; pas « Paradox Powers ex »)
        self.suffix_ok = self.fr_species | {v.split()[-1] for v in forms.values()} | {
            "d'Alola", "Galar", "Hisui", "Paldea", "X", "Y", "Noir", "Blanc"}
        names = sorted(self.sp, key=len, reverse=True)
        self.rx_sp = re.compile(r"(?<![\w-])(" + "|".join(re.escape(n) for n in names) + r")(?![\w])")
        frn = sorted(self.fr_species, key=len, reverse=True)
        self.rx_color = re.compile(r"\b(" + "|".join(COLORS) + r")\s+(" + "|".join(re.escape(n) for n in frn) + r")\b",
                                   re.I)
        # noms anglais de séries (deux mots ou plus) cités dans le détail : « Supreme Victors Poster Pack »
        fr_of = {}
        for sid, (fr, en) in set_names.items():
            fr = self.set_fr(sid)
            if en and fr and straight(en) != straight(fr) and len(straight(en).split()) >= 2:
                fr_of.setdefault(straight(en), fr)
        self.set_en = fr_of
        self.rx_set_en = re.compile(r"(?<![\w'])(" + "|".join(re.escape(n) for n in sorted(fr_of, key=len, reverse=True))
                                    + r")(?![\w'])(?! Products)") if fr_of else None  # « Mega Evolution Products »

    # ---------- séries ----------
    def set_fr(self, sid):
        if not sid:
            return None
        fr, en = self.set_names.get(sid, (None, None))
        return SET_FIX.get(sid) or fr or en

    def set_patterns(self, sid):
        """Expressions qui reconnaissent le nom anglais (ou français) de la série dans un nom Cardmarket, en tolérant
        « & » / « and », la ponctuation et le préfixe « EX » / « Pokémon »."""
        fr, en = self.set_names.get(sid, (None, None))
        out = []
        mcd = re.match(r"Collection McDonald's (\d{4})$", straight(fr or ""))
        for n in (en, fr, f"McDonald's Collection {mcd.group(1)}" if mcd else None):
            if not n:
                continue
            for form in {straight(n), re.sub(r"^(?:Sun & Moon|Sword & Shield|Scarlet & Violet|XY|Black & White)\s*[-:–]?\s*",
                                              "", straight(n))}:
                toks = [t for t in re.findall(r"[0-9A-Za-zÀ-ÿ]+", form) if t.lower() not in ("and",)]
                if not toks:
                    continue
                body = r"[\s&:,.'’-]*(?:and\s+)?".join(re.escape(t) for t in toks)
                out.append((len(form), re.compile(r"(?:^|(?<=[\s:(]))(?:(?:EX|Pok[eé]mon)\s+)?" + body + r"(?![\w'])\s*:?",
                                                  re.I)))
        return [rx for _, rx in sorted(out, key=lambda x: -x[0])]

    # ---------- détail ----------
    def pokemon(self, s, asia=False):
        """Noms de Pokémon et formes : « Mega Charizard X EX » -> « Méga-Dracaufeu X-EX »."""
        s = re.sub(r"\bM(?=[A-Z][a-z])", "Mega ", s)  # « MBlaziken EX » (Cardmarket) = Méga-Braségali-EX
        s = re.sub(r"\bM (?=[A-Z][a-z]+\s+EX\b)", "Mega ", s)
        s = re.sub(r"(.+?)\s+Poncho-wearing Pikachu", r"Pikachu au poncho \1", s)
        s = re.sub(r"\bOrigin Forme\s+([A-Z][a-z]+)", r"\1 Originel", s)  # « Palkia Originel VSTAR » (cartes FR)
        s = re.sub(r"\bPretend (.+?) Pikachu\b", lambda m: "Pikachu déguisé en " + m.group(1).replace("Pretend ", ""), s)
        s = self.rx_sp.sub(lambda m: self.sp[m.group(1)], s)
        s = re.sub(r"\bMega\s+", "Méga-", s)
        s = re.sub(r"\bPrimal\s+", "Primo-", s)
        for adj, fr in (("Alolan", "d'Alola"), ("Galarian", "de Galar"), ("Hisuian", "de Hisui"),
                        ("Paldean", "de Paldea")):
            s = re.sub(r"\b" + adj + r"\s+([A-ZÉ][\wéèêëàâäîïôöûüç'-]+)", r"\1 " + fr, s)
        s = self.rx_color.sub(lambda m: f"{m.group(2)} {COLORS[m.group(1).lower()]}", s)
        # « Pikachu's Gift » -> « Gift de Pikachu » (possessif d'un nom de Pokémon)
        s = re.sub(r"\b([A-ZÉ][\wéèêëàâäîïôöûüç-]+)'s\s+([A-Z][\w ]+)",
                   lambda m: f"{m.group(2).strip()} de {m.group(1)}" if m.group(1) in self.fr_species else m.group(0), s)
        # suffixes de cartes (orthographe française des cartes : Dracaufeu-EX, -GX, -ex ; V, VMAX, VSTAR sans tiret)
        def suffix(m):
            w = m.group(1)
            ok = w in self.suffix_ok or re.sub(r"^(?:Méga|Primo|Ultra)-", "", w) in self.suffix_ok
            return f"{w}-{m.group(2)}" if ok else m.group(0)
        s = re.sub(r"([\wéèêëàâäîïôöûüçÉ'.:-]+)[\s-]+(EX|GX|ex)\b", suffix, s)
        # « Shiny Zacian V » -> « Zacian V chromatique » ; « Inteleon Pin » -> « pin's Lézargus »
        # (japonais : seulement devant un nom de Pokémon, « Shiny Star V » est le nom d'une série)
        def shiny(m):
            return f"{m.group(1)} chromatique" if not asia or self._is_mon(m.group(1)) else m.group(0)
        s = re.sub(r"\bShiny\s+([A-ZÉ][\wéèêëàâäîïôöûüç'-]+(?:\s(?:VMAX|VSTAR|V)\b)?)", shiny, s)
        s = re.sub(r"\b([A-ZÉ][\wéèêëàâäîïôöûüç'-]+(?:\s(?:VMAX|VSTAR|V)\b)?)\s+Shiny\b",
                   lambda m: f"{m.group(1)} chromatique" if self._is_mon(m.group(1)) else m.group(0), s)  # « Crobat V Shiny »
        s = re.sub(r"\b([A-ZÉ][\wéèêëàâäîïôöûüç'-]+(?:\s(?:VMAX|VSTAR|V|de Galar|d'Alola)\b)?(?: chromatique)?)\s+Pin\b",
                   r"pin's \1", s)
        s = re.sub(r"\bLV\.?\s?X\b", "NIV.X", s)
        s = re.sub(r"(?<=[\wé])[\s-]+BREAK\b", "-TURBO", s)
        return s

    def _is_mon(self, w):
        w = re.sub(r"^(?:Méga|Primo|Ultra)-", "", w.split()[0])
        return w.split("-")[0] in self.fr_species or w in self.suffix_ok

    def lines(self, s, asia=False):
        if not asia and self.rx_set_en:  # séries internationales citées (les séries japonaises n'ont pas de nom FR)
            s = self.rx_set_en.sub(lambda m: self.set_en[m.group(1)], s)
        for rx, fr in _LINES:
            s = rx.sub(fr, s)
        if not asia:
            for rx, fr in _WORD_LINES:
                s = rx.sub(fr, s)
        return s

    def energy(self, s):
        """« Fire Charizard GX » (decks japonais) -> « Dracaufeu-GX (type Feu) »."""
        def sub(m):
            mon = m.group(2)
            if mon.split()[0].split("-")[0] not in self.fr_species:
                return m.group(0)
            return f"{mon} (type {ENERGY[m.group(1)]})"
        return re.sub(r"\b(" + "|".join(ENERGY) + r")\s+([A-ZÉ][\wéèêëàâäîïôöûüç'-]*(?:\s(?:VMAX|VSTAR|V)\b)?)", sub, s)

    def detail(self, s, asia=False):
        if asia:
            for rx, fr in _JA_WORDS:
                s = rx.sub(fr, s)
            return self.energy(s)
        for rx, fr in _WORDS:
            s = rx.sub(fr, s)
        s = re.sub(r"\b(\d{4}) (printemps|automne|été|hiver|fêtes|rentrée)\b", r"\2 \1", s)
        s = re.sub(r"\((blue|red|green|yellow|black|white|pink|purple|gray|grey|gold|silver)\)",
                   lambda m: f"({COLORS[m.group(1).lower()]})", s, flags=re.I)
        return s

    # ---------- nom complet ----------
    def name(self, en, kind, sid=None, asia=False, tk=False):
        s = straight(re.sub(r"\s*[—–]\s*", " - ", en))  # tirets longs : séparateurs
        s = re.sub(r'"+', '"', s).replace("BOOster", "Booster")  # « Trick or Trade BOOster »
        s = re.sub(r"\s+", " ", s).strip()
        s = re.sub(r"^(?:[A-Z]{1,5}\d+(?:\.\d+)?[A-Za-z]?|151C)\s*:\s*", "", s)  # « CSV10.6C: », « SV4a: »
        s = re.sub(r"(Blister)\s+(Version \d)$", r"\1 (\2)", s)  # « 2-Pack Blister Version 2 »
        literal = asia and kind in SET_LIKE  # nom de série japonaise : gardé tel quel
        if asia:
            s = re.sub(r"\s+JP\b", "", s)
            for rx, to in JA_REWRITE:
                s = rx.sub(to, s)
        flags = []
        for rx, fr in _FLAGS:
            if rx.search(s):
                s = rx.sub(" ", s)
                if fr:
                    flags.append(fr)
        codes = re.findall(r"\[([^\]]+)\]", s)  # « [GVSE] » : variante, gardée comme détail
        s = re.sub(r"\s*\[[^\]]*\]", " ", s).strip()
        # série en tête (« Temporal Forces Iron Leaves Elite Trainer Box », « EX Deoxys: Jetstream Theme Deck »)
        set_fr = None if tk else self.set_fr(sid)
        if sid and not tk:
            for rx in self.set_patterns(sid):
                m = rx.search(s)
                if m:
                    s = (s[:m.start()] + " " + s[m.end():]).strip()
                    break
        # type
        label, best = DEFAULT.get(kind, "Coffret"), None
        for rx, fr, kinds in _TYPES:
            if kind not in kinds:
                continue
            for m in rx.finditer(s):
                if best is None or len(m.group(0)) > len(best[0].group(0)):
                    best = (m, fr)
        if best:
            m, fr = best
            label = fr.format(*m.groups())
            s = (s[:m.start()] + " " + s[m.end():]).strip()
            # même formule répétée (« V Starter Decks: Mew V Starter Deck ») : retirée aussi
            rx2 = re.compile(r"(?<![\w'])" + r"\s+".join(re.escape(w) for w in m.group(0).split()) + r"?(?![\w'])",
                             re.I)
            s = re.sub(r"\s+", " ", rx2.sub(" ", s)).strip()
        if literal:
            subj = _clean(LEFTOVER.sub(" ", s) if re.search(r"\bBooster\b", s, re.I) else s)
            quals = codes + flags
            out = label + (f" – {subj}" if subj else "") + (f" ({', '.join(quals)})" if quals else "")
            return _clean(out) or DEFAULT.get(kind, "Coffret")
        # gamme avant les deux-points (« Kanto Power Mini Tins: Charizard ») -> mention
        line = None
        if ":" in s:
            parts = [x.strip(" -–") for x in s.split(":")]
            parts = [x for x in parts if x]
            if len(parts) >= 2:
                line, s = ", ".join(parts[:-1]), parts[-1]
            else:
                s = parts[0] if parts else ""
        s = re.sub(r"\s+-\s+", ", ", s)
        if "Deck" in label:
            s = re.sub(r"(?<![\w'])Decks?(?![\w'])", " ", s)  # « … : Méga-Tortank-EX Deck » (le type le dit déjà)
        # produits japonais : noms propres, seul le mot de type final est retiré (« Limited Collection Master … »)
        drop = (lambda x: re.sub(r"\s+(?:Box|Tins?)$", "", x)) if asia else (lambda x: LEFTOVER.sub(" ", x))
        s = _clean(drop(self.detail(self.pokemon(self.lines(s, asia), asia), asia)))
        line = _clean(drop(self.detail(self.pokemon(self.lines(line, asia), asia), asia))) if line else None
        # parenthèses de l'anglais (« Elite Trainer Box (Charizard) ») -> détail
        inner = [_clean(x) for x in re.findall(r"\(([^()]*)\)", s)]
        subj = _clean(re.sub(r"\([^()]*\)", " ", s))
        quals = [x for x in inner if x]
        if not asia:  # mot anglais seul (« 30th Celebration Mini Tin Bundle: Day »)
            subj, quals = SOLO.get(subj, subj), [SOLO.get(q, q) for q in quals]
        if line and EMPTY_LINE.match(line):
            line = None
        if line and line.lower() != subj.lower() and line.lower() not in subj.lower():
            quals.append(line)
        quals += [c for c in codes if c] + flags
        if set_fr:
            det = ", ".join(x for x in [subj] + quals if x)
            out = f"{label} – {set_fr}" + (f" ({det})" if det else "")
        else:
            out = label + (f" {subj}" if subj else "")
            if quals:
                out += f" ({', '.join(quals)})"
        out = _clean(out)
        return out or DEFAULT.get(kind, "Coffret")


def _singular(s):
    return re.sub(r"\b1 (carte|booster)s\b", r"1 \1", s)  # « Booster (1 carte) »


def _clean(s):
    if not s:
        return ""
    s = re.sub(r"\(\s*[,;]?\s*\)", " ", s)
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"\s+([,)])", r"\1", s)
    s = re.sub(r"([(])\s+", r"\1", s)
    s = re.sub(r",\s*,", ",", s)
    s = re.sub(r"\(\s*,\s*", "(", s)
    s = re.sub(r"^[\s,:;&/+-]+|[\s,:;&/+-]+$", "", s)
    s = re.sub(r"\s*[-–]\s*$", "", s)
    s = s.replace("((", "(").replace("))", ")")
    return _singular(s.strip())
