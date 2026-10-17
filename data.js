// Sample route, timetable and fare data.
// Distances, times and fares are approximations for demonstration —
// replace them with official NTC / SLTB figures before real use.

// Fare model: fare = max(minFare, km × ratePerKm), rounded up to the next Rs. 5.
const SERVICE_CLASSES = {
  normal:  { label: "Normal",          ratePerKm: 3.0, minFare: 30,  bookable: false },
  semi:    { label: "Semi-Luxury",     ratePerKm: 4.5, minFare: 50,  bookable: true  },
  ac:      { label: "A/C Luxury",      ratePerKm: 6.0, minFare: 80,  bookable: true  },
  express: { label: "Expressway A/C",  ratePerKm: 8.0, minFare: 150, bookable: true  },
};

// Each route lists its stops as [name, km from the first stop].
// Services: duration (minutes end to end) plus either a regular pattern
// (first, last, every) or an explicit list of departure `times`.
// An optional `inbound` pattern overrides departures for the return direction.
const ROUTES = [
  {
    id: "01",
    name: "Colombo – Kandy",
    stops: [
      ["Colombo (Pettah)", 0], ["Kiribathgoda", 9], ["Kadawatha", 15], ["Nittambuwa", 39],
      ["Warakapola", 52], ["Kegalle", 77], ["Mawanella", 90], ["Kadugannawa", 104],
      ["Peradeniya", 110], ["Kandy", 116],
    ],
    services: {
      normal: { duration: 225, first: "04:30", last: "21:00", every: 15 },
      semi:   { duration: 210, first: "05:00", last: "19:00", every: 60 },
      ac:     { duration: 195, first: "05:00", last: "20:00", every: 30 },
    },
  },
  {
    id: "02",
    name: "Colombo – Matara (Galle Road)",
    stops: [
      ["Colombo (Pettah)", 0], ["Wellawatte", 7], ["Mount Lavinia", 12], ["Moratuwa", 18],
      ["Panadura", 27], ["Kalutara", 42], ["Beruwala", 56], ["Aluthgama", 61],
      ["Ambalangoda", 85], ["Hikkaduwa", 98], ["Galle", 116], ["Unawatuna", 122],
      ["Weligama", 145], ["Matara", 160],
    ],
    services: {
      normal: { duration: 330, first: "04:00", last: "20:00", every: 20 },
      ac:     { duration: 290, first: "05:00", last: "19:00", every: 45 },
    },
  },
  {
    id: "EX1",
    name: "Makumbura – Matara (Southern Expressway)",
    stops: [["Makumbura (Kottawa)", 0], ["Galle", 95], ["Matara", 127]],
    services: {
      express: { duration: 120, first: "04:30", last: "21:30", every: 30 },
    },
  },
  {
    id: "138",
    name: "Colombo – Makumbura (Kottawa)",
    stops: [
      ["Colombo (Pettah)", 0], ["Town Hall", 3], ["Thummulla", 6], ["Kirulapone", 8],
      ["Nugegoda", 11], ["Maharagama", 16], ["Makumbura (Kottawa)", 21],
    ],
    services: {
      normal: { duration: 70, first: "05:00", last: "22:00", every: 10 },
    },
  },
  {
    id: "15",
    name: "Colombo – Anuradhapura",
    stops: [
      ["Colombo (Pettah)", 0], ["Kadawatha", 15], ["Nittambuwa", 39], ["Ambepussa", 59],
      ["Kurunegala", 94], ["Padeniya", 120], ["Thambuttegama", 175], ["Anuradhapura", 205],
    ],
    services: {
      normal: { duration: 330, first: "04:30", last: "17:30", every: 60 },
      ac: {
        duration: 285,
        times: ["05:30", "07:00", "09:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:30"],
      },
    },
  },
  {
    id: "87",
    name: "Colombo – Jaffna",
    stops: [
      ["Colombo (Pettah)", 0], ["Kurunegala", 94], ["Dambulla", 148],
      ["Vavuniya", 254], ["Kilinochchi", 330], ["Jaffna", 396],
    ],
    services: {
      semi: {
        duration: 570,
        times: ["07:30", "20:00"],
        inbound: { times: ["07:00", "19:30"] },
      },
      ac: {
        duration: 540,
        times: ["06:30", "09:00", "19:30", "20:30", "21:00", "21:30", "22:00"],
        inbound: { times: ["06:00", "08:00", "19:00", "20:00", "20:30", "21:00", "22:00"] },
      },
    },
  },
  {
    id: "43",
    name: "Kandy – Nuwara Eliya",
    stops: [
      ["Kandy", 0], ["Peradeniya", 6], ["Gampola", 24], ["Pussellawa", 45],
      ["Ramboda", 58], ["Nuwara Eliya", 77],
    ],
    services: {
      normal: { duration: 180, first: "05:30", last: "18:30", every: 30 },
      semi:   { duration: 165, first: "07:00", last: "17:00", every: 120 },
    },
  },
];

const SEATS_PER_BUS = 45;      // 10 rows of 2+2 plus a back row of 5
const TRANSFER_MINUTES = 10;   // minimum time allowed to change buses
const MAX_SEATS_PER_BOOKING = 6;
const BOOKING_DAYS_AHEAD = 30;
