let restaurant;
let reviews;
var map;

/**
 * Initialize Google map, called from HTML.
 */
window.initMap = () => {
  fetchRestaurantFromURL((error, restaurant) => {
    if (error) { // Got an error!
      console.error(error);
    } else {
      self.map = new google.maps.Map(document.getElementById('map'), {
        zoom: 16,
        center: restaurant.latlng,
        scrollwheel: false
      });
      fillBreadcrumb();
      DBHelper.mapMarkerForRestaurant(self.restaurant, self.map);
    }
  });

  fetchReviewsFromURL((error,reviews) => {
    if (error) {
      console.log(error);
    }
  });
}

/**
 * Get current restaurant from page URL.
 */
fetchRestaurantFromURL = (callback) => {
  if (self.restaurant) { // restaurant already fetched!
    callback(null, self.restaurant)
    return;
  }
  const id = getParameterByName('id');
  if (!id) { // no id found in URL
    error = 'No restaurant id in URL'
    callback(error, null);
  } else {
    DBHelper.fetchRestaurantById(id, (error, restaurant) => {
      self.restaurant = restaurant;
      if (!restaurant) {
        console.error(error);
        return;
      }
      fillRestaurantHTML();
      callback(null, restaurant)
    });
  }
}

/**
 * Create restaurant HTML and add it to the webpage
 */
fillRestaurantHTML = (restaurant = self.restaurant) => {
  const name = document.getElementById('restaurant-name');
  name.innerHTML = restaurant.name;
  name.tabIndex=0;

  const favButton = document.getElementById('favourite');
  if (restaurant.is_favorite==='true' || restaurant.is_favorite===true)  {
    favButton.classList.toggle('fav');
    favButton.classList.toggle('nofav');
  }

  const address = document.getElementById('restaurant-address');
  address.innerHTML = restaurant.address;
  address.tabIndex=0;

  const image = document.getElementById('restaurant-img');
  image.className = 'restaurant-img';
  image.tabIndex=0;

  // Adding alt accessibility
  image.alt=restaurant.photograph_alt;
  image.src = DBHelper.imageUrlForRestaurant(restaurant);
  image.srcset = DBHelper.imagesSrcsetForRestaurant(restaurant);
  // Adding sizes behaviour with media queries.
  image.sizes=DBHelper.imageSizesForRestaurant(false);

  const cuisine = document.getElementById('restaurant-cuisine');
  cuisine.innerHTML = restaurant.cuisine_type;
  cuisine.tabIndex=0;
  cuisine.setAttribute('aria-label',restaurant.cuisine_type + ' cuisine');

  // fill operating hours
  if (restaurant.operating_hours) {
    fillRestaurantHoursHTML();
  }

  //handler form
  handleReviewsForm();

  // fav handler
  handleFavourite();
}

/**
 * Create restaurant operating hours HTML table and add it to the webpage.
 */
fillRestaurantHoursHTML = (operatingHours = self.restaurant.operating_hours) => {
  const hours = document.getElementById('restaurant-hours');
  for (let key in operatingHours) {
    const row = document.createElement('tr');
    row.tabIndex=0;

    const day = document.createElement('td');
    day.innerHTML = key;
    row.appendChild(day);

    const time = document.createElement('td');
    // Create an array with comma separated hours
    // for rearrange the split timetables
    const hoursList=operatingHours[key].split(',');
    for (let index = 0; index < hoursList.length; index++) {
      const splitHour = document.createElement('div');
      splitHour.className='split-hour';
      splitHour.innerHTML=hoursList[index];
      time.appendChild(splitHour);
    }

    //time.innerHTML = operatingHours[key];
    row.appendChild(time);

    hours.appendChild(row);
  }
}


/**
 * Get reviews for current restaurant from page URL.
 */
fetchReviewsFromURL = (callback) => {
  if (self.reviews) { // reviews already fetched!
    callback(null, self.reviews)
    return;
  }
  const id = getParameterByName('id');
  if (!id) { // no id found in URL
    error = 'No restaurant id in URL'
    callback(error, null);
  } else {
    DBHelper.fetchReviewsById(id, (error, reviews) => {
      self.reviews = reviews;
      if (!reviews) {
        console.log(error);
        return;
      }
      // fill reviews
      fillReviewsHTML();
      callback(null, self.reviews)
    });
  }
}

/**
 * Create all reviews HTML and add them to the webpage.
 */
fillReviewsHTML = (reviews = self.reviews) => {
  const container = document.getElementById('reviews-container');
  const title = document.createElement('h2');
  title.innerHTML = 'Reviews';
  container.appendChild(title);

  if (!reviews) {
    const noReviews = document.createElement('p');
    noReviews.className='no-data';
    noReviews.innerHTML = 'No reviews yet!';
    container.appendChild(noReviews);
    return;
  }
  const ul = document.getElementById('reviews-list');
  reviews.forEach(review => {
    ul.appendChild(createReviewHTML(review));
  });
  container.appendChild(ul);
}

// Adding the new review waiting their post to server for include it in
// reviews database
addNewReview = (review) => {
  const container = document.getElementById('reviews-container');
  const noDataP = document.querySelector('.no-data');

  // Remove the no reviews yet messages!
  if (noDataP) container.removeChild(noDataP);
  const ul = document.getElementById('reviews-list');
  ul.appendChild(createReviewHTML(review));
}

/**
 * Create review HTML and add it to the webpage.
 */
createReviewHTML = (review) => {
  const li = document.createElement('li');
  li.tabIndex=0;

  // Create a div for adding a header for name and date
  const header = document.createElement('div');
  header.className='reviews-header';
  li.appendChild(header);

  const name = document.createElement('p');
  name.innerHTML = review.name;
  // Append in header
  header.appendChild(name);

  const createdAt = document.createElement('p');
  createdAt.innerHTML = timeFormatter(review.createdAt);
  // Append in header
  header.appendChild(createdAt);

  const updatedAt = document.createElement('p');
  updatedAt.innerHTML = timeFormatter(review.updatedAt);
  // Append in header
  header.appendChild(updatedAt);


  const rating = document.createElement('p');
  rating.innerHTML = `Rating: ${review.rating}`;
  // Adding class for formatted css
  rating.className="rating";
  li.appendChild(rating);

  const comments = document.createElement('p');
  comments.innerHTML = review.comments;
  li.appendChild(comments);

  return li;
}


timeFormatter = time => {
  const date = new Date(time);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
}

/**
 * Add restaurant name to the breadcrumb navigation menu
 */
fillBreadcrumb = (restaurant=self.restaurant) => {
  const breadcrumb = document.getElementById('breadcrumb');
  const li = document.createElement('li');
  li.innerHTML = restaurant.name;
  breadcrumb.appendChild(li);
}

/**
 * Get a parameter by name from page URL.
 */
getParameterByName = (name, url) => {
  if (!url)
    url = window.location.href;
  name = name.replace(/[\[\]]/g, '\\$&');
  const regex = new RegExp(`[?&]${name}(=([^&#]*)|&|#|$)`),
    results = regex.exec(url);
  if (!results)
    return null;
  if (!results[2])
    return '';
  return decodeURIComponent(results[2].replace(/\+/g, ' '));
}



/**
 * Handle form for creating reviews
 */
handleReviewsForm = (restaurant = self.restaurant) => {
  const form = document.getElementById('reviews-form');

  form.addEventListener('submit', function (event) {
    // Prevent the send of the form
    //debugger;
    event.preventDefault();

    //retrieve the values of the submitted review
    const name = document.getElementById('name');
    const rating = document.getElementById('rating');
    const comments = document.getElementById('comments');

    // Creating an object with information of the review to store in
    // indexedDB
    const review = {
      "restaurant_id": restaurant.id,
      "name": name.value,
      "rating": parseInt(rating.value),
      "comments": comments.value
    }

    // adding review to page, first adding dates
    if (!review.createdAt) review.createdAt=new Date().getTime();
    if (!review.updatedAt) review.updatedAt=new Date().getTime();
    addNewReview(review);
    DBHelper.sendPostRequest(review).catch(error=>console.log(error));

    name.value='';
    rating.value=1;
    comments.value='';

  });
}

handleFavourite = (restaurant = self.restaurant) => {
  const favButton = document.getElementById('favourite');
  favButton.addEventListener('click', function (event) {
    favButton.classList.toggle('fav');
    favButton.classList.toggle('nofav');
    DBHelper.updateRestaurantFav(restaurant.id);
   /* if (restaurant.is_favorite) {
      DBHelper.addToFavorites(restaurant.id)
    } else {
      DBHelper.removeFromFavorites(restaurant.id);
    }*/
  });

}