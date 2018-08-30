let restaurants,
  neighborhoods,
  cuisines
var map
var markers = []

const imageAlts = {
  1: "A view of the restaurant room, a lot of people sitting doown",
	2: "Beautifl view of a enormeous pizza.",
	3: "View the restaurant with grill on tables for cooking",
	4: "The corner of the restauran with a lot lights",
	5: "People eating in restaurant while staff preparing food behind",
	6: "Crowded restaurant with an american flag on the wall",
	7: "Two men walking a dog in front of restaurant.",
	8: "The Dutch outside wall with their logo",
	9: "Black and white picture of people eating with chopsticks.",
	10: "View of this very fashioned restaurant."
}

observer = (entries) => {
  entries.forEach(entry=>{
    console.log('Obvserving');
    console.log(entry.target.dataset.src);
    if (!entry.isIntersecting) return;
    entry.target.src = entry.target.dataset.src;
    entry.target.srcset = entry.target.dataset.srcset;
   // entry.target.sizes = entry.target.dataset.sizes;
    intersectObs.unobserve(entry.target)
    //console.log(entry.target);
  });
}

//Implement intersecction observer for defer image loading
const intersectObs = new IntersectionObserver(observer);

/**
 * Fetch neighborhoods and cuisines as soon as the page is loaded.
 */
document.addEventListener('DOMContentLoaded', (event) => {
  fetchNeighborhoods();
  fetchCuisines();
  updateRestaurants();
  //adding a listener for show the map
  const showButton = document.getElementById('showMap');
  showButton.addEventListener('click', function (event) {
    const mapDiv = document.getElementById('map');
    mapDiv.classList.toggle('hidden');
    showButton.classList.toggle('hidden');
  });

});

/**
 * Fetch all neighborhoods and set their HTML.
 */
fetchNeighborhoods = () => {
  DBHelper.fetchNeighborhoods((error, neighborhoods) => {
    if (error) { // Got an error
      console.error(error);
    } else {
      self.neighborhoods = neighborhoods;
      fillNeighborhoodsHTML();
    }
  });
}

/**
 * Set neighborhoods HTML.
 */
fillNeighborhoodsHTML = (neighborhoods = self.neighborhoods) => {
  const select = document.getElementById('neighborhoods-select');
  neighborhoods.forEach(neighborhood => {
    const option = document.createElement('option');
    option.innerHTML = neighborhood;
    option.value = neighborhood;
    select.append(option);
  });
}

/**
 * Fetch all cuisines and set their HTML.
 */
fetchCuisines = () => {
  DBHelper.fetchCuisines((error, cuisines) => {
    if (error) { // Got an error!
      console.error(error);
    } else {
      self.cuisines = cuisines;
      fillCuisinesHTML();
      initMap();
    }
  });
}

/**
 * Set cuisines HTML.
 */
fillCuisinesHTML = (cuisines = self.cuisines) => {
  const select = document.getElementById('cuisines-select');

  cuisines.forEach(cuisine => {
    const option = document.createElement('option');
    option.innerHTML = cuisine;
    option.value = cuisine;
    select.append(option);
  });
}

/**
 * Initialize Google map, called from HTML.
 */
window.initMap = () => {
  let loc = {
    lat: 40.722216,
    lng: -73.987501
  };
  self.map = new google.maps.Map(document.getElementById('map'), {
    zoom: 12,
    center: loc,
    scrollwheel: false
  });
  updateRestaurants();
}

/**
 * Update page and map for current restaurants.
 */
updateRestaurants = () => {
  const cSelect = document.getElementById('cuisines-select');
  const nSelect = document.getElementById('neighborhoods-select');

  const cIndex = cSelect.selectedIndex;
  const nIndex = nSelect.selectedIndex;

  const cuisine = cSelect[cIndex].value;
  const neighborhood = nSelect[nIndex].value;

  DBHelper.fetchRestaurantByCuisineAndNeighborhood(cuisine, neighborhood, (error, restaurants) => {
    if (error) { // Got an error!
      console.error(error);
    } else {
      resetRestaurants(restaurants);
      fillRestaurantsHTML();
    }
  })
}

/**
 * Clear current restaurants, their HTML and remove their map markers.
 */
resetRestaurants = (restaurants) => {
  // Remove all restaurants
  self.restaurants = [];
  const ul = document.getElementById('restaurants-list');
  ul.innerHTML = '';

  // Remove all map markers
  self.markers.forEach(m => m.setMap(null));
  self.markers = [];
  self.restaurants = restaurants;
}

/**
 * Create all restaurants HTML and add them to the webpage.
 */
fillRestaurantsHTML = (restaurants = self.restaurants) => {
  const ul = document.getElementById('restaurants-list');
  restaurants.forEach(restaurant => {
    ul.append(createRestaurantHTML(restaurant));
  });
  addMarkersToMap();
}

/**
 * Create restaurant HTML.
 */
createRestaurantHTML = (restaurant) => {
  const li = document.createElement('li');
  li.tabIndex=0;

  const image = document.createElement('img');
  image.className = 'restaurant-img';

  //ADding Accesibility attributes
  image.alt=imageAlts[restaurant.id];
  image.dataset.src = DBHelper.imageUrlForRestaurant(restaurant);
  image.dataset.srcset = DBHelper.imagesSrcsetForRestaurant(restaurant);
  // Adding sizes behaviour with media queries.
  image.sizes=DBHelper.imageSizesForRestaurant(restaurant);
  li.append(image);
  intersectObs.observe(image);

  // The element must be h2, h1 is for the name of the webpage
  const name = document.createElement('h2');
  name.innerHTML = restaurant.name;
  li.append(name);

  const neighborhood = document.createElement('p');
  neighborhood.innerHTML = restaurant.neighborhood;
  li.append(neighborhood);

  const address = document.createElement('p');
  address.innerHTML = restaurant.address;
  li.append(address);

  const more = document.createElement('a');
  more.innerHTML = 'View Details';
  more.setAttribute('aria-label', 'View Details for ' + restaurant.name);
  more.href = DBHelper.urlForRestaurant(restaurant);
  li.append(more)

  return li
}

/**
 * Add markers for current restaurants to the map.
 */
addMarkersToMap = (restaurants = self.restaurants) => {
  restaurants.forEach(restaurant => {
    // Add marker to the map
    const marker = DBHelper.mapMarkerForRestaurant(restaurant, self.map);
    google.maps.event.addListener(marker, 'click', () => {
      window.location.href = marker.url
    });
    self.markers.push(marker);
  });
}

