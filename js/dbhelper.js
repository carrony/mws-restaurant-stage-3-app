/**
 * Common database helper functions.
 */
class DBHelper {

  /**
   * Database URL.
   * Change this to restaurants.json file location on your server.
   */
  static get DATABASE_URL() {
    const port = 1337 // Change this to your server port
    return `http://localhost:${port}/restaurants`;
  }

  // /**
  //  * Fetch all restaurants.
  //  */
  // static fetchRestaurants(callback) {
  //   let xhr = new XMLHttpRequest();
  //   xhr.open('GET', DBHelper.DATABASE_URL);
  //   xhr.onload = () => {
  //     if (xhr.status === 200) { // Got a success response from server!
  //       const json = JSON.parse(xhr.responseText);
  //       const restaurants = json.restaurants;
  //       callback(null, restaurants);
  //     } else { // Oops!. Got an error from server.
  //       const error = (`Request failed. Returned status of ${xhr.status}`);
  //       callback(error, null);
  //     }
  //   };
  //   xhr.send();
  // }



  /**
   * Fetch all restaurants.
   */
  static fetchRestaurants(callback) {
    const dbPromise = idb.open('restauntsDB', 1, function(upgradeDb) {
      upgradeDb.createObjectStore('restaurants' , {
        keyPath: 'id'
      });
    });

    dbPromise.then(function(db) {
      // create the transaction in read/write operation and open the store for restaurants
      var tx = db.transaction('restaurants');
      var restaurantStore = tx.objectStore('restaurants');
      return restaurantStore.getAll();
    }).then(function (restaurants){
      if (restaurants.length == 0 ) {
        console.log("no hay datos");
        // No data on BBDD. Fetching from our server
        fetch(DBHelper.DATABASE_URL)
          .then(response => response.json())
          .then(function(restaurants) {
            // adding to database
            dbPromise.then( db =>{
              var tx = db.transaction('restaurants','readwrite');
            var restaurantStore = tx.objectStore('restaurants');

            restaurants.forEach(element => {
              restaurantStore.put(element);
            });
            callback(null,restaurants);
            });
          })
          .catch(function(error) {
            callback(error,null);
          })
      } else {
        // Restuarants in DB
        callback(null,restaurants);
      }
    })
  }

  /**
   * Fetch a restaurant by its ID.
   */
  static fetchRestaurantById(id, callback) {
    // fetch all restaurants with proper error handling.
    DBHelper.fetchRestaurants((error, restaurants) => {
      if (error) {
        callback(error, null);
      } else {
        const restaurant = restaurants.find(r => r.id == id);
        if (restaurant) { // Got the restaurant
          callback(null, restaurant);
        } else { // Restaurant does not exist in the database
          callback('Restaurant does not exist', null);
        }
      }
    });
  }

  /**
   * Fetch restaurants by a cuisine type with proper error handling.
   */
  static fetchRestaurantByCuisine(cuisine, callback) {
    // Fetch all restaurants  with proper error handling
    DBHelper.fetchRestaurants((error, restaurants) => {
      if (error) {
        callback(error, null);
      } else {
        // Filter restaurants to have only given cuisine type
        const results = restaurants.filter(r => r.cuisine_type == cuisine);
        callback(null, results);
      }
    });
  }

  /**
   * Fetch restaurants by a neighborhood with proper error handling.
   */
  static fetchRestaurantByNeighborhood(neighborhood, callback) {
    // Fetch all restaurants
    DBHelper.fetchRestaurants((error, restaurants) => {
      if (error) {
        callback(error, null);
      } else {
        // Filter restaurants to have only given neighborhood
        const results = restaurants.filter(r => r.neighborhood == neighborhood);
        callback(null, results);
      }
    });
  }

  /**
   * Fetch restaurants by a cuisine and a neighborhood with proper error handling.
   */
  static fetchRestaurantByCuisineAndNeighborhood(cuisine, neighborhood, callback) {
    // Fetch all restaurants
    DBHelper.fetchRestaurants((error, restaurants) => {
      if (error) {
        callback(error, null);
      } else {
        let results = restaurants;
        if (cuisine != 'all') { // filter by cuisine
          results = results.filter(r => r.cuisine_type == cuisine);
        }
        if (neighborhood != 'all') { // filter by neighborhood
          results = results.filter(r => r.neighborhood == neighborhood);
        }
        callback(null, results);
      }
    });
  }

  /**
   * Fetch all neighborhoods with proper error handling.
   */
  static fetchNeighborhoods(callback) {
    // Fetch all restaurants
    DBHelper.fetchRestaurants((error, restaurants) => {
      if (error) {
        callback(error, null);
      } else {
        // Get all neighborhoods from all restaurants
        const neighborhoods = restaurants.map((v, i) => restaurants[i].neighborhood)
        // Remove duplicates from neighborhoods
        const uniqueNeighborhoods = neighborhoods.filter((v, i) => neighborhoods.indexOf(v) == i)
        callback(null, uniqueNeighborhoods);
      }
    });
  }

  /**
   * Fetch all cuisines with proper error handling.
   */
  static fetchCuisines(callback) {
    // Fetch all restaurants
    DBHelper.fetchRestaurants((error, restaurants) => {
      if (error) {
        callback(error, null);
      } else {
        // Get all cuisines from all restaurants
        const cuisines = restaurants.map((v, i) => restaurants[i].cuisine_type)
        // Remove duplicates from cuisines
        const uniqueCuisines = cuisines.filter((v, i) => cuisines.indexOf(v) == i)
        callback(null, uniqueCuisines);
      }
    });
  }

  /**
   * Restaurant page URL.
   */
  static urlForRestaurant(restaurant) {
    return (`./restaurant.html?id=${restaurant.id}`);
  }

  /**
   * Restaurant image srcset for responsives images.
   */
  static imagesSrcsetForRestaurant(restaurant) {
    // adding atributtes for responsive images
    const extension="jpg";//restaurant.photograph.match(/\.([^.\\\/]+)$/).pop();
    let filename = restaurant.photograph;//restaurant.photograph.replace(/\.([^.\\\/]+)$/,'')
    if (!filename) filename="10";
    return (`/img/${filename}-small.${extension} 250w,
            /img/${filename}-medium.${extension} 460w,
            /img/${filename}-large.${extension} 800w`);
  }

  /**
   * Restaurant image srcset for responsives images.
   */
  static imageSizesForRestaurant(inner) {
    // adding atributtes for responsive images
    if (inner) return `(max-width: 618px) calc(100vw - 80px), calc(50vw - 80px)`;
    return `(max-width: 618px) calc(100vw - 90px), calc(50vw - 90px)`;
  }

   /**
   * Restaurant image srcset.
   */
  static imageUrlForRestaurant(restaurant) {
    // adding atributtes for responsive images
    const extension="jpg";//restaurant.photograph.match(/\.([^.\\\/]+)$/).pop();
    let filename = restaurant.photograph;//restaurant.photograph.replace(/\.([^.\\\/]+)$/,'')
    if (!filename) filename="10";
    return (`/img/${filename}-small.${extension}`);
  }

  /**
   * Map marker for a restaurant.
   */
  static mapMarkerForRestaurant(restaurant, map) {
    const marker = new google.maps.Marker({
      position: restaurant.latlng,
      title: restaurant.name,
      url: DBHelper.urlForRestaurant(restaurant),
      map: map,
      animation: google.maps.Animation.DROP}
    );
    return marker;
  }

}
