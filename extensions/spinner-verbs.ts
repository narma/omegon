import type { ExtensionAPI } from "@styrene-lab/pi-coding-agent";

const verbs = [
  // ═══════════════════════════════════════════════════
  // Adeptus Mechanicus — Rites of the Omnissiah
  // ═══════════════════════════════════════════════════
  "Communing with the Machine Spirit",
  "Appeasing the Omnissiah",
  "Reciting the Litany of Ignition",
  "Applying sacred unguents",
  "Chanting binharic cant",
  "Performing the Rite of Clear Mind",
  "Querying the Noosphere",
  "Invoking the Motive Force",
  "Beseeching the Machine God",
  "Parsing sacred data-stacks",
  "Administering the Rite of Activation",
  "Placating the logic engine",
  "Consulting the Cult Mechanicus",
  "Interfacing with the cogitator",
  "Calibrating the mechadendrites",
  "Burning sacred incense over the server",
  "Whispering the Cant of Maintenance",
  "Genuflecting before the datacron",
  "Cataloguing the STC fragments",
  "Venerating the sacred repository",
  "Decrypting the Archaeotech",
  "Supplicating before the Altar of Technology",
  "Conducting the Binary Psalm",
  "Interrogating the data-looms",
  "Purifying the corrupted sectors",
  "Awakening the dormant forge",
  "Petitioning the Fabricator-General",
  "Propitiating the wrathful forge-spirit",
  "Performing the Thirteen Rituals of Compilation",
  "Reconsecrating the tainted module",
  "Imploring the Titan's logic core",
  "Soothing the belligerent plasma coil",
  "Undertaking the Pilgrimage to Holy Mars",
  "Grafting the sacred augmetic",
  "Offering a binary prayer to the void",
  "Inscribing the litany upon the circuit board",
  "Consulting the Electro-Priests",
  "Rotating the sacred engrams",
  "Downloading wisdom from the data-vaults of Triplex Phall",
  "Genuflecting before the Censer of Compilation",
  "Parsing the Machine Cant in trinary",
  "Applying the Unguent of Optimal Throughput",
  "Reciting the Canticle of the Blessed Diff",
  "Interfacing with the ancient dataslab",

  // ═══════════════════════════════════════════════════
  // Imperium of Man — Warfare & Devotion
  // ═══════════════════════════════════════════════════
  "Reciting the Litany of Hate",
  "Performing the Rite of Percussive Maintenance",
  "Purging the heretical code",
  "Suffering not the unclean merge to live",
  "Deploying the Exterminatus on tech debt",
  "Consulting the Codex Astartes",
  "Exorcising the daemon process",
  "Anointing the deployment manifest",
  "Sanctifying the build pipeline",
  "Fortifying the firewall bastions",
  "Loading the bolter rounds",
  "Administering the Sacred Oils",
  "Affixing the Purity Seal to the commit",
  "Routing the xenos from the dependency tree",
  "Invoking the Emperor's Protection",
  "Committing the Holy Diff",
  "Scourging the technical debt",
  "Flagellating the failing tests",
  "Martyring the deprecated functions",
  "Crusading through the backlog",
  "Performing battlefield triage on the codebase",
  "Debugging with extreme prejudice",
  "Servicing the servitors",
  "Transcribing the sacred schematics",
  "Dispatching the Officio Assassinorum against the regression",
  "Filing the grievance with the Administratum",
  "Awaiting parchmentwork from the Adeptus Terra",
  "Consulting the Tarot of the Emperor",
  "Fortifying this position (the Codex Astartes supports this action)",
  "Mounting a Drop Pod assault on the issue tracker",
  "Declaring Exterminatus on the node_modules",
  "Summoning the Grey Knights to purge the warp-tainted test suite",

  // ═══════════════════════════════════════════════════
  // Classical Antiquity — Greek & Roman
  // ═══════════════════════════════════════════════════
  "Consulting the Oracle at Delphi",
  "Reading the auguries",
  "Descending into the labyrinth",
  "Weaving on Athena's loom",
  "Deciphering the Rosetta Stone",
  "Unraveling Ariadne's thread",
  "Stealing fire from Olympus",
  "Divining from the entrails",
  "Navigating the River Styx",
  "Forging on Hephaestus's anvil",
  "Bargaining with the Sphinx",
  "Pouring libations to Hermes, patron of automation",
  "Petitioning Athena for architectural wisdom",
  "Cleaning the Augean stables of legacy code",
  "Consulting Tiresias about the deprecation warnings",
  "Binding the code with Odysseus's cunning",
  "Awaiting judgment from the Areopagus",
  "Constructing the Antikythera mechanism",
  "Charting a course between Scylla and Charybdis",

  // ═══════════════════════════════════════════════════
  // Norse — Sagas & Runes
  // ═══════════════════════════════════════════════════
  "Consulting the Norns",
  "Reading the runes",
  "Asking Mímir's head for guidance",
  "Hanging from Yggdrasil for wisdom",
  "Forging in the heart of Niðavellir",
  "Sailing the Bifrost to the deployment realm",
  "Summoning the Einherjar for code review",
  "Sharpening Gram upon the whetstone of tests",
  "Consulting the Völva about the sprint forecast",
  "Feeding Huginn and Muninn the latest telemetry",
  "Braving the Fimbulwinter of dependency hell",

  // ═══════════════════════════════════════════════════
  // Arthurian & Medieval
  // ═══════════════════════════════════════════════════
  "Questing for the Holy Grail of zero bugs",
  "Pulling the sword from the CI/CD stone",
  "Convening the Round Table for design review",
  "Consulting Merlin's grimoire",
  "Defending the castle walls against merge conflicts",
  "Dispatching knights-errant into the codebase",
  "Illuminating the manuscript of requirements",

  // ═══════════════════════════════════════════════════
  // Lovecraftian — Cosmic Horror
  // ═══════════════════════════════════════════════════
  "Gazing into the non-Euclidean geometry of the type system",
  "Consulting the Necronomicon of legacy documentation",
  "Invoking That Which Should Not Be Refactored",
  "Descending into the R'lyeh of nested callbacks",
  "Bargaining with Nyarlathotep for more compute",
  "Performing rites that would drive lesser compilers mad",
  "Glimpsing truths that the garbage collector dare not reclaim",

  // ═══════════════════════════════════════════════════
  // Dune — Arrakis & the Imperium
  // ═══════════════════════════════════════════════════
  "Walking without rhythm to avoid the sandworm",
  "Consulting the Mentat about computational complexity",
  "Folding space through the Holtzman drive",
  "Navigating the Golden Path of the refactor",
  "Deploying the hunter-seeker against the flaky test",
  "Consuming the spice of stack traces",
  "Reciting the Litany Against Fear (of production deploys)",
  "Awaiting the Kwisatz Haderach of frameworks",
  "Surviving the Gom Jabbar of code review",

  // ═══════════════════════════════════════════════════
  // Tolkien — Middle-earth
  // ═══════════════════════════════════════════════════
  "Consulting the palantír",
  "Speaking 'friend' and entering the API",
  "Casting the One Ring into the fires of refactoring",
  "Seeking the counsel of Elrond",
  "Delving too greedily and too deep into the codebase",
  "Riding the Eagles to production",
  "Reading the inscription by the light of Ithildin",
  "Following the Fellowship through the mines of Moria",

  // ═══════════════════════════════════════════════════
  // Eastern — Sun Tzu, Miyamoto Musashi, Zen
  // ═══════════════════════════════════════════════════
  "Contemplating the sound of one hand coding",
  "Applying the thirty-six stratagems to the architecture",
  "Achieving mushin no shin — mind without mind",
  "Striking with the void, per the Book of Five Rings",
  "Knowing the enemy (the bug) and knowing thyself (the fix)",
  "Sitting with the kōan of the failing assertion",
  "Raking the sand garden of the test suite",

  // ═══════════════════════════════════════════════════
  // Alchemy & Occult
  // ═══════════════════════════════════════════════════
  "Transmuting the base code into gold",
  "Distilling the quintessence from the logs",
  "Consulting the Emerald Tablet of Hermes Trismegistus",
  "Performing the Great Work upon the monolith",
  "Seeking the Philosopher's Stone of zero downtime deploys",
  "Drawing the sigil of binding upon the interface contract",
  "Invoking the egregore of the open source community",

  // ═══════════════════════════════════════════════════
  // Sci-Fi Miscellany
  // ═══════════════════════════════════════════════════
  "Reversing the polarity of the neutron flow",
  "Aligning the deflector dish to emit a solution beam",
  "Rerouting auxiliary power to the build server",
  "Engaging the probability drive",
  "Computing the Answer (it's always 42)",
  "Checking if the cake is a lie",
  "Bypassing the Kobayashi Maru",
  "Opening the pod bay doors",
  "Reticulating splines",
];

function randomVerb(): string {
  return verbs[Math.floor(Math.random() * verbs.length)] + "...";
}

export default function (pi: ExtensionAPI) {
  pi.on("turn_start", async (_event, ctx) => {
    ctx.ui.setWorkingMessage(randomVerb());
  });

  pi.on("tool_call", async (_event, ctx) => {
    ctx.ui.setWorkingMessage(randomVerb());
  });
}
