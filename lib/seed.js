/** Default catalogue shipped with the site: the products and "Our Works" gallery as they appeared before they became editable.
 *  Used only when the database has no products / gallery yet (a fresh install, or an existing site's first start after this was added). */
const PRODUCTS = [
  {
    "id": "p-paddy-pre-cleaner",
    "name": "Paddy Pre-Cleaner",
    "summary": "Removes stalks, dust and stones from paddy before it enters the mill, so every machine downstream runs clean.",
    "spec": "Made to any capacity",
    "image": "images/paddy-precleaner.jpg",
    "imageCaption": "Paddy pre-cleaner",
    "photos": [],
    "home": true,
    "visible": true
  },
  {
    "id": "p-bucket-elevators",
    "name": "Bucket Elevators",
    "summary": "Engineered for dryers, parboiling lines and silos, plus standalone individual elevators.",
    "spec": "304 SS bucket chain · 150–600mm width",
    "image": "images/machine-11.jpg",
    "imageCaption": "",
    "photos": [],
    "home": true,
    "visible": true
  },
  {
    "id": "p-paddy-dryers",
    "name": "Paddy Dryers",
    "summary": "Single and double vertical dryers, even moisture reduction sized to your throughput.",
    "spec": "Made to any capacity",
    "image": "images/dryer-24-ton.jpg",
    "imageCaption": "24 ton double dryer",
    "photos": [
      {
        "src": "images/paddy-dryer-56-ton.jpg",
        "caption": "56 ton paddy dryer"
      },
      {
        "src": "images/complete-dryer-parboiling-silo-set-1.jpg",
        "caption": "Complete dryer, parboiling and silo set"
      },
      {
        "src": "images/complete-dryer-parboiling-silo-set-2.jpg",
        "caption": "Complete dryer, parboiling and silo set (another view)"
      }
    ],
    "home": true,
    "visible": true
  },
  {
    "id": "p-parboiling-plants",
    "name": "Parboiling Plants",
    "summary": "Pressure parboiling systems, with water-tank integration, built for consistent grain strength and colour.",
    "spec": "Made to any capacity",
    "image": "images/parboiling-32-ton.jpg",
    "imageCaption": "32 ton parboiling plant",
    "photos": [
      {
        "src": "images/parboiling-18-ton.jpg",
        "caption": "18 ton parboiling plant"
      },
      {
        "src": "images/parboiling-dual-type.jpg",
        "caption": "Dual type pressure cum parboiling plant"
      },
      {
        "src": "images/parboiling-32-ton-water-tank.jpg",
        "caption": "32 ton parboiling with 50 KL water tank"
      },
      {
        "src": "images/dryer-parboiling-full-plant.jpg",
        "caption": "Dryer and parboiling full plant"
      }
    ],
    "home": true,
    "visible": true
  },
  {
    "id": "p-paddy-rice-storage-silos",
    "name": "Paddy & Rice Storage Silos",
    "summary": "Custom-capacity paddy and rice storage silos built to your site footprint.",
    "spec": "304 SS · custom capacity",
    "image": "images/paddy-silo-wall.jpg",
    "imageCaption": "Paddy storage silo",
    "photos": [
      {
        "src": "images/paddy-silo-tall.jpg",
        "caption": "Paddy storage silo (full height)"
      },
      {
        "src": "images/rice-silo.jpg",
        "caption": "Rice storage silo"
      }
    ],
    "home": true,
    "visible": true
  },
  {
    "id": "p-dust-collector-systems",
    "name": "Dust Collector Systems",
    "summary": "Twin-cyclone separators and dust collection units for a cleaner mill floor.",
    "spec": "twin-cyclone design",
    "image": "images/dust-collector.jpg",
    "imageCaption": "",
    "photos": [],
    "home": true,
    "visible": true
  },
  {
    "id": "p-centrifugal-blowers-pulleys",
    "name": "Centrifugal Blowers & Pulleys",
    "summary": "Low-power-consumption blowers, pulleys and vibrating screens engineered to last.",
    "spec": "low power draw",
    "image": "images/works-07.jpg",
    "imageCaption": "Centrifugal blower",
    "photos": [],
    "home": true,
    "visible": true
  },
  {
    "id": "p-screw-tube-conveyors",
    "name": "Screw & Tube Conveyors",
    "summary": "FRP tube and screw conveyors for flour mills and rice mill transfer lines.",
    "spec": "FRP / 304 SS body",
    "image": "images/screw-tube-conveyor.jpg",
    "imageCaption": "Screw conveyor and tube conveyor in flour mill",
    "photos": [
      {
        "src": "images/tube-conveyor.jpg",
        "caption": "Tube conveyor"
      },
      {
        "src": "images/screw-conveyor-flour-mill.jpg",
        "caption": "Screw conveyor for flour mill"
      }
    ],
    "home": true,
    "visible": true
  },
  {
    "id": "p-belt-conveyors",
    "name": "Belt Conveyors",
    "summary": "Heavy-duty trough belt conveyors for high-volume grain transfer.",
    "spec": "reinforced belt",
    "image": "images/belt-conveyor.jpg",
    "imageCaption": "",
    "photos": [],
    "home": true,
    "visible": true
  },
  {
    "id": "p-water-tanks",
    "name": "Water Tanks",
    "summary": "Steel water tanks sized for parboiling plants, up to 50 KL capacity.",
    "spec": "up to 50 KL",
    "image": "images/water-tank.jpg",
    "imageCaption": "",
    "photos": [],
    "home": true,
    "visible": true
  },
  {
    "id": "p-paddy-separators-stroke-chalna",
    "name": "Paddy Separators (Stroke Chalna)",
    "summary": "Vibrating stroke chalna units that separate paddy from brown rice with precision.",
    "spec": "vibrating stroke deck",
    "image": "images/stroke-chalna.jpg",
    "imageCaption": "",
    "photos": [],
    "home": true,
    "visible": true
  },
  {
    "id": "p-heat-exchangers",
    "name": "Heat Exchangers",
    "summary": "Finned-tube heat exchangers for efficient, even drying performance.",
    "spec": "finned-tube design",
    "image": "images/heat-exchanger.jpg",
    "imageCaption": "",
    "photos": [],
    "home": true,
    "visible": true
  },
  {
    "id": "p-s-s-pipeline-fittings",
    "name": "S.S. Pipeline Fittings",
    "summary": "Polished stainless-steel Y and T-joint pipeline fittings for flour mill ducting.",
    "spec": "304 SS polished finish",
    "image": "images/pipeline-fittings.jpg",
    "imageCaption": "",
    "photos": [],
    "home": true,
    "visible": true
  },
  {
    "id": "p-screw-conveyor-drive-units",
    "name": "Screw Conveyor Drive Units",
    "summary": "Geared motor drive assemblies built for continuous-duty screw and tube conveyors.",
    "spec": "geared motor drive",
    "image": "images/machine-23.jpg",
    "imageCaption": "",
    "photos": [],
    "home": true,
    "visible": true
  }
];
const GALLERY = [
  {
    "id": "g-1",
    "src": "images/hero-plant.jpg",
    "caption": "",
    "shape": "leaf",
    "w": 1280,
    "h": 960
  },
  {
    "id": "g-2",
    "src": "images/works-14.jpg",
    "caption": "",
    "shape": "arch",
    "w": 1191,
    "h": 1500
  },
  {
    "id": "g-3",
    "src": "images/factory-01.jpg",
    "caption": "",
    "shape": "round",
    "w": 1024,
    "h": 557
  },
  {
    "id": "g-4",
    "src": "images/works-10.jpg",
    "caption": "",
    "shape": "round",
    "w": 644,
    "h": 912
  },
  {
    "id": "g-5",
    "src": "images/works-15.jpg",
    "caption": "",
    "shape": "arch",
    "w": 702,
    "h": 1500
  },
  {
    "id": "g-6",
    "src": "images/machine-03.jpg",
    "caption": "",
    "shape": "leaf",
    "w": 1024,
    "h": 817
  },
  {
    "id": "g-7",
    "src": "images/works-07.jpg",
    "caption": "",
    "shape": "round",
    "w": 1280,
    "h": 1232
  },
  {
    "id": "g-8",
    "src": "images/works-12.jpg",
    "caption": "",
    "shape": "pill",
    "w": 906,
    "h": 430
  },
  {
    "id": "g-9",
    "src": "images/parboiling-dual-type.jpg",
    "caption": "",
    "shape": "leaf",
    "w": 1280,
    "h": 960
  },
  {
    "id": "g-10",
    "src": "images/works-13.jpg",
    "caption": "",
    "shape": "round",
    "w": 1107,
    "h": 1280
  },
  {
    "id": "g-11",
    "src": "images/machine-04.jpg",
    "caption": "",
    "shape": "round",
    "w": 1024,
    "h": 858
  },
  {
    "id": "g-12",
    "src": "images/paddy-dryer-56-ton.jpg",
    "caption": "",
    "shape": "arch",
    "w": 573,
    "h": 1280
  },
  {
    "id": "g-13",
    "src": "images/factory-02.jpg",
    "caption": "",
    "shape": "leaf",
    "w": 1024,
    "h": 558
  },
  {
    "id": "g-14",
    "src": "images/works-16.jpg",
    "caption": "",
    "shape": "round",
    "w": 960,
    "h": 1280
  },
  {
    "id": "g-15",
    "src": "images/works-08.jpg",
    "caption": "",
    "shape": "arch",
    "w": 883,
    "h": 1280
  },
  {
    "id": "g-16",
    "src": "images/parboiling-32-ton.jpg",
    "caption": "",
    "shape": "leaf",
    "w": 727,
    "h": 1004
  },
  {
    "id": "g-17",
    "src": "images/machine-02.jpg",
    "caption": "",
    "shape": "round",
    "w": 1024,
    "h": 576
  },
  {
    "id": "g-18",
    "src": "images/machine-24.jpg",
    "caption": "",
    "shape": "leaf",
    "w": 1009,
    "h": 1024
  }
];
const STEPS = [
  {
    "id": "s-pre-cleaning",
    "title": "Pre-Cleaning",
    "summary": "Removes stalks, dust and stones before paddy enters the mill.",
    "details": "Removes stalks, dust and stones before paddy enters the mill, protecting every downstream machine from debris and wear.",
    "image": "images/paddy-precleaner.jpg",
    "visible": true
  },
  {
    "id": "s-parboiling",
    "title": "Parboiling",
    "summary": "Steam-pressure plants that lock in nutrition and grain strength.",
    "details": "Steam-pressure parboiling plants lock in nutrition and grain strength, with integrated water tanks sized up to 50 KL for continuous operation.",
    "image": "images/parboiling-32-ton.jpg",
    "visible": true
  },
  {
    "id": "s-vertical-drying",
    "title": "Vertical Drying",
    "summary": "Reduces moisture evenly for consistent milling quality.",
    "details": "Multi-pass vertical dryers reduce moisture evenly across the grain, sized to your daily throughput in any capacity you need, for consistent milling quality batch after batch.",
    "image": "images/dryer-24-ton.jpg",
    "visible": true
  },
  {
    "id": "s-elevator-transfer",
    "title": "Elevator Transfer",
    "summary": "Heavy-duty bucket elevators move grain between every stage.",
    "details": "Heavy-duty bucket elevators move grain cleanly between every stage of the line, engineered for dryers, parboiling sections, silos and standalone use.",
    "image": "images/works-12.jpg",
    "visible": true
  },
  {
    "id": "s-silo-storage",
    "title": "Silo & Storage",
    "summary": "Custom-capacity paddy and rice silos with dust collection.",
    "details": "Custom-capacity paddy and rice silos, plus dust collection and cyclone systems, keep grain protected and your mill floor clean until it's ready to move on.",
    "image": "images/paddy-silo-wall.jpg",
    "visible": true
  },
  {
    "id": "s-milling-output",
    "title": "Milling & Output",
    "summary": "A complete, tension-free pre-milling section ready for your mill.",
    "details": "A complete, tension-free pre-milling section — screw and tube conveyors, blowers, pulleys and pipeline fittings all engineered to work as one line, ready for your mill.",
    "image": "images/factory-01.jpg",
    "visible": true
  }
];
module.exports = { products: () => JSON.parse(JSON.stringify(PRODUCTS)), gallery: () => JSON.parse(JSON.stringify(GALLERY)), steps: () => JSON.parse(JSON.stringify(STEPS)) };
