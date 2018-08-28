'use strict';

//for compatible browsers
if (navigator.serviceWorker) {
    // REgistering the service worker
    navigator.serviceWorker.register('./sw.js', {
        scope: './'
    }).then(function (reg) {
        console.log('sevice worker registered');
    }).catch(function (err) {
        console.log('error registering...');
    });
}
'use strict';

(function () {
  function toArray(arr) {
    return Array.prototype.slice.call(arr);
  }

  function promisifyRequest(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () {
        resolve(request.result);
      };

      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  function promisifyRequestCall(obj, method, args) {
    var request;
    var p = new Promise(function (resolve, reject) {
      request = obj[method].apply(obj, args);
      promisifyRequest(request).then(resolve, reject);
    });

    p.request = request;
    return p;
  }

  function promisifyCursorRequestCall(obj, method, args) {
    var p = promisifyRequestCall(obj, method, args);
    return p.then(function (value) {
      if (!value) return;
      return new Cursor(value, p.request);
    });
  }

  function proxyProperties(ProxyClass, targetProp, properties) {
    properties.forEach(function (prop) {
      Object.defineProperty(ProxyClass.prototype, prop, {
        get: function get() {
          return this[targetProp][prop];
        },
        set: function set(val) {
          this[targetProp][prop] = val;
        }
      });
    });
  }

  function proxyRequestMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function (prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function () {
        return promisifyRequestCall(this[targetProp], prop, arguments);
      };
    });
  }

  function proxyMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function (prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function () {
        return this[targetProp][prop].apply(this[targetProp], arguments);
      };
    });
  }

  function proxyCursorRequestMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function (prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function () {
        return promisifyCursorRequestCall(this[targetProp], prop, arguments);
      };
    });
  }

  function Index(index) {
    this._index = index;
  }

  proxyProperties(Index, '_index', ['name', 'keyPath', 'multiEntry', 'unique']);

  proxyRequestMethods(Index, '_index', IDBIndex, ['get', 'getKey', 'getAll', 'getAllKeys', 'count']);

  proxyCursorRequestMethods(Index, '_index', IDBIndex, ['openCursor', 'openKeyCursor']);

  function Cursor(cursor, request) {
    this._cursor = cursor;
    this._request = request;
  }

  proxyProperties(Cursor, '_cursor', ['direction', 'key', 'primaryKey', 'value']);

  proxyRequestMethods(Cursor, '_cursor', IDBCursor, ['update', 'delete']);

  // proxy 'next' methods
  ['advance', 'continue', 'continuePrimaryKey'].forEach(function (methodName) {
    if (!(methodName in IDBCursor.prototype)) return;
    Cursor.prototype[methodName] = function () {
      var cursor = this;
      var args = arguments;
      return Promise.resolve().then(function () {
        cursor._cursor[methodName].apply(cursor._cursor, args);
        return promisifyRequest(cursor._request).then(function (value) {
          if (!value) return;
          return new Cursor(value, cursor._request);
        });
      });
    };
  });

  function ObjectStore(store) {
    this._store = store;
  }

  ObjectStore.prototype.createIndex = function () {
    return new Index(this._store.createIndex.apply(this._store, arguments));
  };

  ObjectStore.prototype.index = function () {
    return new Index(this._store.index.apply(this._store, arguments));
  };

  proxyProperties(ObjectStore, '_store', ['name', 'keyPath', 'indexNames', 'autoIncrement']);

  proxyRequestMethods(ObjectStore, '_store', IDBObjectStore, ['put', 'add', 'delete', 'clear', 'get', 'getAll', 'getKey', 'getAllKeys', 'count']);

  proxyCursorRequestMethods(ObjectStore, '_store', IDBObjectStore, ['openCursor', 'openKeyCursor']);

  proxyMethods(ObjectStore, '_store', IDBObjectStore, ['deleteIndex']);

  function Transaction(idbTransaction) {
    this._tx = idbTransaction;
    this.complete = new Promise(function (resolve, reject) {
      idbTransaction.oncomplete = function () {
        resolve();
      };
      idbTransaction.onerror = function () {
        reject(idbTransaction.error);
      };
      idbTransaction.onabort = function () {
        reject(idbTransaction.error);
      };
    });
  }

  Transaction.prototype.objectStore = function () {
    return new ObjectStore(this._tx.objectStore.apply(this._tx, arguments));
  };

  proxyProperties(Transaction, '_tx', ['objectStoreNames', 'mode']);

  proxyMethods(Transaction, '_tx', IDBTransaction, ['abort']);

  function UpgradeDB(db, oldVersion, transaction) {
    this._db = db;
    this.oldVersion = oldVersion;
    this.transaction = new Transaction(transaction);
  }

  UpgradeDB.prototype.createObjectStore = function () {
    return new ObjectStore(this._db.createObjectStore.apply(this._db, arguments));
  };

  proxyProperties(UpgradeDB, '_db', ['name', 'version', 'objectStoreNames']);

  proxyMethods(UpgradeDB, '_db', IDBDatabase, ['deleteObjectStore', 'close']);

  function DB(db) {
    this._db = db;
  }

  DB.prototype.transaction = function () {
    return new Transaction(this._db.transaction.apply(this._db, arguments));
  };

  proxyProperties(DB, '_db', ['name', 'version', 'objectStoreNames']);

  proxyMethods(DB, '_db', IDBDatabase, ['close']);

  // Add cursor iterators
  // TODO: remove this once browsers do the right thing with promises
  ['openCursor', 'openKeyCursor'].forEach(function (funcName) {
    [ObjectStore, Index].forEach(function (Constructor) {
      // Don't create iterateKeyCursor if openKeyCursor doesn't exist.
      if (!(funcName in Constructor.prototype)) return;

      Constructor.prototype[funcName.replace('open', 'iterate')] = function () {
        var args = toArray(arguments);
        var callback = args[args.length - 1];
        var nativeObject = this._store || this._index;
        var request = nativeObject[funcName].apply(nativeObject, args.slice(0, -1));
        request.onsuccess = function () {
          callback(request.result);
        };
      };
    });
  });

  // polyfill getAll
  [Index, ObjectStore].forEach(function (Constructor) {
    if (Constructor.prototype.getAll) return;
    Constructor.prototype.getAll = function (query, count) {
      var instance = this;
      var items = [];

      return new Promise(function (resolve) {
        instance.iterateCursor(query, function (cursor) {
          if (!cursor) {
            resolve(items);
            return;
          }
          items.push(cursor.value);

          if (count !== undefined && items.length == count) {
            resolve(items);
            return;
          }
          cursor.continue();
        });
      });
    };
  });

  var exp = {
    open: function open(name, version, upgradeCallback) {
      var p = promisifyRequestCall(indexedDB, 'open', [name, version]);
      var request = p.request;

      if (request) {
        request.onupgradeneeded = function (event) {
          if (upgradeCallback) {
            upgradeCallback(new UpgradeDB(request.result, event.oldVersion, request.transaction));
          }
        };
      }

      return p.then(function (db) {
        return new DB(db);
      });
    },
    delete: function _delete(name) {
      return promisifyRequestCall(indexedDB, 'deleteDatabase', [name]);
    }
  };

  if (typeof module !== 'undefined') {
    module.exports = exp;
    module.exports.default = module.exports;
  } else {
    self.idb = exp;
  }
})();
'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/**
 * Common database helper functions.
 */
var DBHelper = function () {
  function DBHelper() {
    _classCallCheck(this, DBHelper);
  }

  _createClass(DBHelper, null, [{
    key: 'fetchRestaurants',


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
    value: function fetchRestaurants(callback) {
      var dbPromise = idb.open('restauntsDB', 1, function (upgradeDb) {
        upgradeDb.createObjectStore('restaurants', {
          keyPath: 'id'
        });
      });

      dbPromise.then(function (db) {
        // create the transaction in read/write operation and open the store for restaurants
        var tx = db.transaction('restaurants');
        var restaurantStore = tx.objectStore('restaurants');
        return restaurantStore.getAll();
      }).then(function (restaurants) {
        if (restaurants.length == 0) {
          console.log("no hay datos");
          // No data on BBDD. Fetching from our server
          fetch(DBHelper.DATABASE_URL).then(function (response) {
            return response.json();
          }).then(function (restaurants) {
            // adding to database
            dbPromise.then(function (db) {
              var tx = db.transaction('restaurants', 'readwrite');
              var restaurantStore = tx.objectStore('restaurants');

              restaurants.forEach(function (element) {
                restaurantStore.put(element);
              });
              callback(null, restaurants);
            });
          }).catch(function (error) {
            callback(error, null);
          });
        } else {
          // Restuarants in DB
          callback(null, restaurants);
        }
      });
    }

    /**
     * Fetch a restaurant by its ID.
     */

  }, {
    key: 'fetchRestaurantById',
    value: function fetchRestaurantById(id, callback) {
      // fetch all restaurants with proper error handling.
      DBHelper.fetchRestaurants(function (error, restaurants) {
        if (error) {
          callback(error, null);
        } else {
          var restaurant = restaurants.find(function (r) {
            return r.id == id;
          });
          if (restaurant) {
            // Got the restaurant
            callback(null, restaurant);
          } else {
            // Restaurant does not exist in the database
            callback('Restaurant does not exist', null);
          }
        }
      });
    }

    /**
     * Fetch restaurants by a cuisine type with proper error handling.
     */

  }, {
    key: 'fetchRestaurantByCuisine',
    value: function fetchRestaurantByCuisine(cuisine, callback) {
      // Fetch all restaurants  with proper error handling
      DBHelper.fetchRestaurants(function (error, restaurants) {
        if (error) {
          callback(error, null);
        } else {
          // Filter restaurants to have only given cuisine type
          var results = restaurants.filter(function (r) {
            return r.cuisine_type == cuisine;
          });
          callback(null, results);
        }
      });
    }

    /**
     * Fetch restaurants by a neighborhood with proper error handling.
     */

  }, {
    key: 'fetchRestaurantByNeighborhood',
    value: function fetchRestaurantByNeighborhood(neighborhood, callback) {
      // Fetch all restaurants
      DBHelper.fetchRestaurants(function (error, restaurants) {
        if (error) {
          callback(error, null);
        } else {
          // Filter restaurants to have only given neighborhood
          var results = restaurants.filter(function (r) {
            return r.neighborhood == neighborhood;
          });
          callback(null, results);
        }
      });
    }

    /**
     * Fetch restaurants by a cuisine and a neighborhood with proper error handling.
     */

  }, {
    key: 'fetchRestaurantByCuisineAndNeighborhood',
    value: function fetchRestaurantByCuisineAndNeighborhood(cuisine, neighborhood, callback) {
      // Fetch all restaurants
      DBHelper.fetchRestaurants(function (error, restaurants) {
        if (error) {
          callback(error, null);
        } else {
          var results = restaurants;
          if (cuisine != 'all') {
            // filter by cuisine
            results = results.filter(function (r) {
              return r.cuisine_type == cuisine;
            });
          }
          if (neighborhood != 'all') {
            // filter by neighborhood
            results = results.filter(function (r) {
              return r.neighborhood == neighborhood;
            });
          }
          callback(null, results);
        }
      });
    }

    /**
     * Fetch all neighborhoods with proper error handling.
     */

  }, {
    key: 'fetchNeighborhoods',
    value: function fetchNeighborhoods(callback) {
      // Fetch all restaurants
      DBHelper.fetchRestaurants(function (error, restaurants) {
        if (error) {
          callback(error, null);
        } else {
          // Get all neighborhoods from all restaurants
          var neighborhoods = restaurants.map(function (v, i) {
            return restaurants[i].neighborhood;
          });
          // Remove duplicates from neighborhoods
          var uniqueNeighborhoods = neighborhoods.filter(function (v, i) {
            return neighborhoods.indexOf(v) == i;
          });
          callback(null, uniqueNeighborhoods);
        }
      });
    }

    /**
     * Fetch all cuisines with proper error handling.
     */

  }, {
    key: 'fetchCuisines',
    value: function fetchCuisines(callback) {
      // Fetch all restaurants
      DBHelper.fetchRestaurants(function (error, restaurants) {
        if (error) {
          callback(error, null);
        } else {
          // Get all cuisines from all restaurants
          var cuisines = restaurants.map(function (v, i) {
            return restaurants[i].cuisine_type;
          });
          // Remove duplicates from cuisines
          var uniqueCuisines = cuisines.filter(function (v, i) {
            return cuisines.indexOf(v) == i;
          });
          callback(null, uniqueCuisines);
        }
      });
    }

    /**
     * Restaurant page URL.
     */

  }, {
    key: 'urlForRestaurant',
    value: function urlForRestaurant(restaurant) {
      return './restaurant.html?id=' + restaurant.id;
    }

    /**
     * Restaurant image srcset for responsives images.
     */

  }, {
    key: 'imagesSrcsetForRestaurant',
    value: function imagesSrcsetForRestaurant(restaurant) {
      // adding atributtes for responsive images
      var extension = "jpg"; //restaurant.photograph.match(/\.([^.\\\/]+)$/).pop();
      var filename = restaurant.photograph; //restaurant.photograph.replace(/\.([^.\\\/]+)$/,'')
      if (!filename) filename = "10";
      return '/img/' + filename + '-small.' + extension + ' 250w,\n            /img/' + filename + '-medium.' + extension + ' 460w,\n            /img/' + filename + '-large.' + extension + ' 800w';
    }

    /**
     * Restaurant image srcset for responsives images.
     */

  }, {
    key: 'imageSizesForRestaurant',
    value: function imageSizesForRestaurant(inner) {
      // adding atributtes for responsive images
      if (inner) return '(max-width: 618px) calc(100vw - 80px), calc(50vw - 80px)';
      return '(max-width: 618px) calc(100vw - 90px), calc(50vw - 90px)';
    }

    /**
    * Restaurant image srcset.
    */

  }, {
    key: 'imageUrlForRestaurant',
    value: function imageUrlForRestaurant(restaurant) {
      // adding atributtes for responsive images
      var extension = "jpg"; //restaurant.photograph.match(/\.([^.\\\/]+)$/).pop();
      var filename = restaurant.photograph; //restaurant.photograph.replace(/\.([^.\\\/]+)$/,'')
      if (!filename) filename = "10";
      return '/img/' + filename + '-small.' + extension;
    }

    /**
     * Map marker for a restaurant.
     */

  }, {
    key: 'mapMarkerForRestaurant',
    value: function mapMarkerForRestaurant(restaurant, map) {
      var marker = new google.maps.Marker({
        position: restaurant.latlng,
        title: restaurant.name,
        url: DBHelper.urlForRestaurant(restaurant),
        map: map,
        animation: google.maps.Animation.DROP });
      return marker;
    }
  }, {
    key: 'DATABASE_URL',


    /**
     * Database URL.
     * Change this to restaurants.json file location on your server.
     */
    get: function get() {
      var port = 1337; // Change this to your server port
      return 'http://localhost:' + port + '/restaurants';
    }
  }]);

  return DBHelper;
}();
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInN3X3JlZ2lzdGVyLmpzIiwiaWRiLmpzIiwiZGJoZWxwZXIuanMiXSwibmFtZXMiOlsibmF2aWdhdG9yIiwic2VydmljZVdvcmtlciIsInJlZ2lzdGVyIiwic2NvcGUiLCJ0aGVuIiwicmVnIiwiY29uc29sZSIsImxvZyIsImNhdGNoIiwiZXJyIiwidG9BcnJheSIsImFyciIsIkFycmF5IiwicHJvdG90eXBlIiwic2xpY2UiLCJjYWxsIiwicHJvbWlzaWZ5UmVxdWVzdCIsInJlcXVlc3QiLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsIm9uc3VjY2VzcyIsInJlc3VsdCIsIm9uZXJyb3IiLCJlcnJvciIsInByb21pc2lmeVJlcXVlc3RDYWxsIiwib2JqIiwibWV0aG9kIiwiYXJncyIsInAiLCJhcHBseSIsInByb21pc2lmeUN1cnNvclJlcXVlc3RDYWxsIiwidmFsdWUiLCJDdXJzb3IiLCJwcm94eVByb3BlcnRpZXMiLCJQcm94eUNsYXNzIiwidGFyZ2V0UHJvcCIsInByb3BlcnRpZXMiLCJmb3JFYWNoIiwicHJvcCIsIk9iamVjdCIsImRlZmluZVByb3BlcnR5IiwiZ2V0Iiwic2V0IiwidmFsIiwicHJveHlSZXF1ZXN0TWV0aG9kcyIsIkNvbnN0cnVjdG9yIiwiYXJndW1lbnRzIiwicHJveHlNZXRob2RzIiwicHJveHlDdXJzb3JSZXF1ZXN0TWV0aG9kcyIsIkluZGV4IiwiaW5kZXgiLCJfaW5kZXgiLCJJREJJbmRleCIsImN1cnNvciIsIl9jdXJzb3IiLCJfcmVxdWVzdCIsIklEQkN1cnNvciIsIm1ldGhvZE5hbWUiLCJPYmplY3RTdG9yZSIsInN0b3JlIiwiX3N0b3JlIiwiY3JlYXRlSW5kZXgiLCJJREJPYmplY3RTdG9yZSIsIlRyYW5zYWN0aW9uIiwiaWRiVHJhbnNhY3Rpb24iLCJfdHgiLCJjb21wbGV0ZSIsIm9uY29tcGxldGUiLCJvbmFib3J0Iiwib2JqZWN0U3RvcmUiLCJJREJUcmFuc2FjdGlvbiIsIlVwZ3JhZGVEQiIsImRiIiwib2xkVmVyc2lvbiIsInRyYW5zYWN0aW9uIiwiX2RiIiwiY3JlYXRlT2JqZWN0U3RvcmUiLCJJREJEYXRhYmFzZSIsIkRCIiwiZnVuY05hbWUiLCJyZXBsYWNlIiwiY2FsbGJhY2siLCJsZW5ndGgiLCJuYXRpdmVPYmplY3QiLCJnZXRBbGwiLCJxdWVyeSIsImNvdW50IiwiaW5zdGFuY2UiLCJpdGVtcyIsIml0ZXJhdGVDdXJzb3IiLCJwdXNoIiwidW5kZWZpbmVkIiwiY29udGludWUiLCJleHAiLCJvcGVuIiwibmFtZSIsInZlcnNpb24iLCJ1cGdyYWRlQ2FsbGJhY2siLCJpbmRleGVkREIiLCJvbnVwZ3JhZGVuZWVkZWQiLCJldmVudCIsImRlbGV0ZSIsIm1vZHVsZSIsImV4cG9ydHMiLCJkZWZhdWx0Iiwic2VsZiIsImlkYiIsIkRCSGVscGVyIiwiZGJQcm9taXNlIiwidXBncmFkZURiIiwia2V5UGF0aCIsInR4IiwicmVzdGF1cmFudFN0b3JlIiwicmVzdGF1cmFudHMiLCJmZXRjaCIsIkRBVEFCQVNFX1VSTCIsInJlc3BvbnNlIiwianNvbiIsInB1dCIsImVsZW1lbnQiLCJpZCIsImZldGNoUmVzdGF1cmFudHMiLCJyZXN0YXVyYW50IiwiZmluZCIsInIiLCJjdWlzaW5lIiwicmVzdWx0cyIsImZpbHRlciIsImN1aXNpbmVfdHlwZSIsIm5laWdoYm9yaG9vZCIsIm5laWdoYm9yaG9vZHMiLCJtYXAiLCJ2IiwiaSIsInVuaXF1ZU5laWdoYm9yaG9vZHMiLCJpbmRleE9mIiwiY3Vpc2luZXMiLCJ1bmlxdWVDdWlzaW5lcyIsImV4dGVuc2lvbiIsImZpbGVuYW1lIiwicGhvdG9ncmFwaCIsImlubmVyIiwibWFya2VyIiwiZ29vZ2xlIiwibWFwcyIsIk1hcmtlciIsInBvc2l0aW9uIiwibGF0bG5nIiwidGl0bGUiLCJ1cmwiLCJ1cmxGb3JSZXN0YXVyYW50IiwiYW5pbWF0aW9uIiwiQW5pbWF0aW9uIiwiRFJPUCIsInBvcnQiXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQSxJQUFJQSxVQUFVQyxhQUFkLEVB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QyxVQUFJLENBQUNELFFBQUwsRUFBZUEsV0FBUyxJQUFUO0FBQ2YsdUJBQWdCQSxRQUFoQixlQUFrQ0QsU0FBbEMsaUNBQ2VDLFFBRGYsZ0JBQ2tDRCxTQURsQyxpQ0FFZUMsUUFGZixlQUVpQ0QsU0FGakM7QUFHRDs7QUFFRDs7Ozs7OzRDQUcrQkcsSyxFQUFPO0FBQ3BDO0FBQ0EsVUFBSUEsS0FBSixFQUFXO0FBQ1g7QUFDRDs7QUFFQTs7Ozs7OzBDQUc0Qm5CLFUsRUFBWTtBQUN2QztBQUNBLFVBQU1nQixZQUFVLEtBQWhCLENBRnVDLENBRWpCO0FBQ3RCLFVBQUlDLFdBQVdqQixXQUFXa0IsVUFBMUIsQ0FIdUMsQ0FHRjtBQUNyQyxVQUFJLENBQUNELFFBQUwsRUFBZUEsV0FBUyxJQUFUO0FBQ2YsdUJBQWdCQSxRQUFoQixlQUFrQ0QsU0FBbEM7QUFDRDs7QUFFRDs7Ozs7OzJDQUc4QmhCLFUsRUFBWVMsRyxFQUFLO0FBQzdDLFVBQU1XLFNBQVMsSUFBSUMsT0FBT0MsSUFBUCxDQUFZQyxNQUFoQixDQUF1QjtBQUNwQ0Msa0JBQVV4QixXQUFXeUIsTUFEZTtBQUVwQ0MsZUFBTzFCLFdBQVczQixJQUZrQjtBQUdwQ3NELGFBQUsxQyxTQUFTMkMsZ0JBQVQsQ0FBMEI1QixVQUExQixDQUgrQjtBQUlwQ1MsYUFBS0EsR0FKK0I7QUFLcENvQixtQkFBV1IsT0FBT0MsSUFBUCxDQUFZUSxTQUFaLENBQXNCQyxJQUxHLEVBQXZCLENBQWY7QUFPQSxhQUFPWCxNQUFQO0FBQ0Q7Ozs7O0FBek9EOzs7O3dCQUkwQjtBQUN4QixVQUFNWSxPQUFPLElBQWIsQ0FEd0IsQ0FDTjtBQUNsQixtQ0FBMkJBLElBQTNCO0FBQ0QiLCJmaWxlIjoiYWxsLmpzIiwic291cmNlc0NvbnRlbnQiOlsiLy9mb3IgY29tcGF0aWJsZSBicm93c2Vyc1xyXG5pZiAobmF2aWdhdG9yLnNlcnZpY2VXb3JrZXIpIHtcclxuICAgIC8vIFJFZ2lzdGVyaW5nIHRoZSBzZXJ2aWNlIHdvcmtlclxyXG4gICAgbmF2aWdhdG9yLnNlcnZpY2VXb3JrZXIucmVnaXN0ZXIoJy4vc3cuanMnLHtcclxuICAgICAgICBzY29wZTogJy4vJ1xyXG4gICAgfSkudGhlbihmdW5jdGlvbihyZWcpIHtcclxuICAgICAgICBjb25zb2xlLmxvZygnc2V2aWNlIHdvcmtlciByZWdpc3RlcmVkJylcclxuICAgIH0pLmNhdGNoKGZ1bmN0aW9uKGVycikge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdlcnJvciByZWdpc3RlcmluZy4uLicpO1xyXG4gICAgfSk7XHJcbn1cclxuXHJcblxyXG5cclxuIiwiJ3VzZSBzdHJpY3QnO1xuXG4oZnVuY3Rpb24oKSB7XG4gIGZ1bmN0aW9uIHRvQXJyYXkoYXJyKSB7XG4gICAgcmV0dXJuIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFycik7XG4gIH1cblxuICBmdW5jdGlvbiBwcm9taXNpZnlSZXF1ZXN0KHJlcXVlc3QpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICByZXF1ZXN0Lm9uc3VjY2VzcyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXNvbHZlKHJlcXVlc3QucmVzdWx0KTtcbiAgICAgIH07XG5cbiAgICAgIHJlcXVlc3Qub25lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZWplY3QocmVxdWVzdC5lcnJvcik7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJvbWlzaWZ5UmVxdWVzdENhbGwob2JqLCBtZXRob2QsIGFyZ3MpIHtcbiAgICB2YXIgcmVxdWVzdDtcbiAgICB2YXIgcCA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgcmVxdWVzdCA9IG9ialttZXRob2RdLmFwcGx5KG9iaiwgYXJncyk7XG4gICAgICBwcm9taXNpZnlSZXF1ZXN0KHJlcXVlc3QpLnRoZW4ocmVzb2x2ZSwgcmVqZWN0KTtcbiAgICB9KTtcblxuICAgIHAucmVxdWVzdCA9IHJlcXVlc3Q7XG4gICAgcmV0dXJuIHA7XG4gIH1cblxuICBmdW5jdGlvbiBwcm9taXNpZnlDdXJzb3JSZXF1ZXN0Q2FsbChvYmosIG1ldGhvZCwgYXJncykge1xuICAgIHZhciBwID0gcHJvbWlzaWZ5UmVxdWVzdENhbGwob2JqLCBtZXRob2QsIGFyZ3MpO1xuICAgIHJldHVybiBwLnRoZW4oZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgIGlmICghdmFsdWUpIHJldHVybjtcbiAgICAgIHJldHVybiBuZXcgQ3Vyc29yKHZhbHVlLCBwLnJlcXVlc3QpO1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJveHlQcm9wZXJ0aWVzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIHByb3BlcnRpZXMpIHtcbiAgICBwcm9wZXJ0aWVzLmZvckVhY2goZnVuY3Rpb24ocHJvcCkge1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFByb3h5Q2xhc3MucHJvdG90eXBlLCBwcm9wLCB7XG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXNbdGFyZ2V0UHJvcF1bcHJvcF07XG4gICAgICAgIH0sXG4gICAgICAgIHNldDogZnVuY3Rpb24odmFsKSB7XG4gICAgICAgICAgdGhpc1t0YXJnZXRQcm9wXVtwcm9wXSA9IHZhbDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm94eVJlcXVlc3RNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgICAgUHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHByb21pc2lmeVJlcXVlc3RDYWxsKHRoaXNbdGFyZ2V0UHJvcF0sIHByb3AsIGFyZ3VtZW50cyk7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJveHlNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgICAgUHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXNbdGFyZ2V0UHJvcF1bcHJvcF0uYXBwbHkodGhpc1t0YXJnZXRQcm9wXSwgYXJndW1lbnRzKTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm94eUN1cnNvclJlcXVlc3RNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgICAgUHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHByb21pc2lmeUN1cnNvclJlcXVlc3RDYWxsKHRoaXNbdGFyZ2V0UHJvcF0sIHByb3AsIGFyZ3VtZW50cyk7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gSW5kZXgoaW5kZXgpIHtcbiAgICB0aGlzLl9pbmRleCA9IGluZGV4O1xuICB9XG5cbiAgcHJveHlQcm9wZXJ0aWVzKEluZGV4LCAnX2luZGV4JywgW1xuICAgICduYW1lJyxcbiAgICAna2V5UGF0aCcsXG4gICAgJ211bHRpRW50cnknLFxuICAgICd1bmlxdWUnXG4gIF0pO1xuXG4gIHByb3h5UmVxdWVzdE1ldGhvZHMoSW5kZXgsICdfaW5kZXgnLCBJREJJbmRleCwgW1xuICAgICdnZXQnLFxuICAgICdnZXRLZXknLFxuICAgICdnZXRBbGwnLFxuICAgICdnZXRBbGxLZXlzJyxcbiAgICAnY291bnQnXG4gIF0pO1xuXG4gIHByb3h5Q3Vyc29yUmVxdWVzdE1ldGhvZHMoSW5kZXgsICdfaW5kZXgnLCBJREJJbmRleCwgW1xuICAgICdvcGVuQ3Vyc29yJyxcbiAgICAnb3BlbktleUN1cnNvcidcbiAgXSk7XG5cbiAgZnVuY3Rpb24gQ3Vyc29yKGN1cnNvciwgcmVxdWVzdCkge1xuICAgIHRoaXMuX2N1cnNvciA9IGN1cnNvcjtcbiAgICB0aGlzLl9yZXF1ZXN0ID0gcmVxdWVzdDtcbiAgfVxuXG4gIHByb3h5UHJvcGVydGllcyhDdXJzb3IsICdfY3Vyc29yJywgW1xuICAgICdkaXJlY3Rpb24nLFxuICAgICdrZXknLFxuICAgICdwcmltYXJ5S2V5JyxcbiAgICAndmFsdWUnXG4gIF0pO1xuXG4gIHByb3h5UmVxdWVzdE1ldGhvZHMoQ3Vyc29yLCAnX2N1cnNvcicsIElEQkN1cnNvciwgW1xuICAgICd1cGRhdGUnLFxuICAgICdkZWxldGUnXG4gIF0pO1xuXG4gIC8vIHByb3h5ICduZXh0JyBtZXRob2RzXG4gIFsnYWR2YW5jZScsICdjb250aW51ZScsICdjb250aW51ZVByaW1hcnlLZXknXS5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZE5hbWUpIHtcbiAgICBpZiAoIShtZXRob2ROYW1lIGluIElEQkN1cnNvci5wcm90b3R5cGUpKSByZXR1cm47XG4gICAgQ3Vyc29yLnByb3RvdHlwZVttZXRob2ROYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGN1cnNvciA9IHRoaXM7XG4gICAgICB2YXIgYXJncyA9IGFyZ3VtZW50cztcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKGZ1bmN0aW9uKCkge1xuICAgICAgICBjdXJzb3IuX2N1cnNvclttZXRob2ROYW1lXS5hcHBseShjdXJzb3IuX2N1cnNvciwgYXJncyk7XG4gICAgICAgIHJldHVybiBwcm9taXNpZnlSZXF1ZXN0KGN1cnNvci5fcmVxdWVzdCkudGhlbihmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgIGlmICghdmFsdWUpIHJldHVybjtcbiAgICAgICAgICByZXR1cm4gbmV3IEN1cnNvcih2YWx1ZSwgY3Vyc29yLl9yZXF1ZXN0KTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9O1xuICB9KTtcblxuICBmdW5jdGlvbiBPYmplY3RTdG9yZShzdG9yZSkge1xuICAgIHRoaXMuX3N0b3JlID0gc3RvcmU7XG4gIH1cblxuICBPYmplY3RTdG9yZS5wcm90b3R5cGUuY3JlYXRlSW5kZXggPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IEluZGV4KHRoaXMuX3N0b3JlLmNyZWF0ZUluZGV4LmFwcGx5KHRoaXMuX3N0b3JlLCBhcmd1bWVudHMpKTtcbiAgfTtcblxuICBPYmplY3RTdG9yZS5wcm90b3R5cGUuaW5kZXggPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IEluZGV4KHRoaXMuX3N0b3JlLmluZGV4LmFwcGx5KHRoaXMuX3N0b3JlLCBhcmd1bWVudHMpKTtcbiAgfTtcblxuICBwcm94eVByb3BlcnRpZXMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBbXG4gICAgJ25hbWUnLFxuICAgICdrZXlQYXRoJyxcbiAgICAnaW5kZXhOYW1lcycsXG4gICAgJ2F1dG9JbmNyZW1lbnQnXG4gIF0pO1xuXG4gIHByb3h5UmVxdWVzdE1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuICAgICdwdXQnLFxuICAgICdhZGQnLFxuICAgICdkZWxldGUnLFxuICAgICdjbGVhcicsXG4gICAgJ2dldCcsXG4gICAgJ2dldEFsbCcsXG4gICAgJ2dldEtleScsXG4gICAgJ2dldEFsbEtleXMnLFxuICAgICdjb3VudCdcbiAgXSk7XG5cbiAgcHJveHlDdXJzb3JSZXF1ZXN0TWV0aG9kcyhPYmplY3RTdG9yZSwgJ19zdG9yZScsIElEQk9iamVjdFN0b3JlLCBbXG4gICAgJ29wZW5DdXJzb3InLFxuICAgICdvcGVuS2V5Q3Vyc29yJ1xuICBdKTtcblxuICBwcm94eU1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuICAgICdkZWxldGVJbmRleCdcbiAgXSk7XG5cbiAgZnVuY3Rpb24gVHJhbnNhY3Rpb24oaWRiVHJhbnNhY3Rpb24pIHtcbiAgICB0aGlzLl90eCA9IGlkYlRyYW5zYWN0aW9uO1xuICAgIHRoaXMuY29tcGxldGUgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIGlkYlRyYW5zYWN0aW9uLm9uY29tcGxldGUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfTtcbiAgICAgIGlkYlRyYW5zYWN0aW9uLm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVqZWN0KGlkYlRyYW5zYWN0aW9uLmVycm9yKTtcbiAgICAgIH07XG4gICAgICBpZGJUcmFuc2FjdGlvbi5vbmFib3J0ID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlamVjdChpZGJUcmFuc2FjdGlvbi5lcnJvcik7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgVHJhbnNhY3Rpb24ucHJvdG90eXBlLm9iamVjdFN0b3JlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBPYmplY3RTdG9yZSh0aGlzLl90eC5vYmplY3RTdG9yZS5hcHBseSh0aGlzLl90eCwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgcHJveHlQcm9wZXJ0aWVzKFRyYW5zYWN0aW9uLCAnX3R4JywgW1xuICAgICdvYmplY3RTdG9yZU5hbWVzJyxcbiAgICAnbW9kZSdcbiAgXSk7XG5cbiAgcHJveHlNZXRob2RzKFRyYW5zYWN0aW9uLCAnX3R4JywgSURCVHJhbnNhY3Rpb24sIFtcbiAgICAnYWJvcnQnXG4gIF0pO1xuXG4gIGZ1bmN0aW9uIFVwZ3JhZGVEQihkYiwgb2xkVmVyc2lvbiwgdHJhbnNhY3Rpb24pIHtcbiAgICB0aGlzLl9kYiA9IGRiO1xuICAgIHRoaXMub2xkVmVyc2lvbiA9IG9sZFZlcnNpb247XG4gICAgdGhpcy50cmFuc2FjdGlvbiA9IG5ldyBUcmFuc2FjdGlvbih0cmFuc2FjdGlvbik7XG4gIH1cblxuICBVcGdyYWRlREIucHJvdG90eXBlLmNyZWF0ZU9iamVjdFN0b3JlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBPYmplY3RTdG9yZSh0aGlzLl9kYi5jcmVhdGVPYmplY3RTdG9yZS5hcHBseSh0aGlzLl9kYiwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgcHJveHlQcm9wZXJ0aWVzKFVwZ3JhZGVEQiwgJ19kYicsIFtcbiAgICAnbmFtZScsXG4gICAgJ3ZlcnNpb24nLFxuICAgICdvYmplY3RTdG9yZU5hbWVzJ1xuICBdKTtcblxuICBwcm94eU1ldGhvZHMoVXBncmFkZURCLCAnX2RiJywgSURCRGF0YWJhc2UsIFtcbiAgICAnZGVsZXRlT2JqZWN0U3RvcmUnLFxuICAgICdjbG9zZSdcbiAgXSk7XG5cbiAgZnVuY3Rpb24gREIoZGIpIHtcbiAgICB0aGlzLl9kYiA9IGRiO1xuICB9XG5cbiAgREIucHJvdG90eXBlLnRyYW5zYWN0aW9uID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBUcmFuc2FjdGlvbih0aGlzLl9kYi50cmFuc2FjdGlvbi5hcHBseSh0aGlzLl9kYiwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgcHJveHlQcm9wZXJ0aWVzKERCLCAnX2RiJywgW1xuICAgICduYW1lJyxcbiAgICAndmVyc2lvbicsXG4gICAgJ29iamVjdFN0b3JlTmFtZXMnXG4gIF0pO1xuXG4gIHByb3h5TWV0aG9kcyhEQiwgJ19kYicsIElEQkRhdGFiYXNlLCBbXG4gICAgJ2Nsb3NlJ1xuICBdKTtcblxuICAvLyBBZGQgY3Vyc29yIGl0ZXJhdG9yc1xuICAvLyBUT0RPOiByZW1vdmUgdGhpcyBvbmNlIGJyb3dzZXJzIGRvIHRoZSByaWdodCB0aGluZyB3aXRoIHByb21pc2VzXG4gIFsnb3BlbkN1cnNvcicsICdvcGVuS2V5Q3Vyc29yJ10uZm9yRWFjaChmdW5jdGlvbihmdW5jTmFtZSkge1xuICAgIFtPYmplY3RTdG9yZSwgSW5kZXhdLmZvckVhY2goZnVuY3Rpb24oQ29uc3RydWN0b3IpIHtcbiAgICAgIC8vIERvbid0IGNyZWF0ZSBpdGVyYXRlS2V5Q3Vyc29yIGlmIG9wZW5LZXlDdXJzb3IgZG9lc24ndCBleGlzdC5cbiAgICAgIGlmICghKGZ1bmNOYW1lIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcblxuICAgICAgQ29uc3RydWN0b3IucHJvdG90eXBlW2Z1bmNOYW1lLnJlcGxhY2UoJ29wZW4nLCAnaXRlcmF0ZScpXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgYXJncyA9IHRvQXJyYXkoYXJndW1lbnRzKTtcbiAgICAgICAgdmFyIGNhbGxiYWNrID0gYXJnc1thcmdzLmxlbmd0aCAtIDFdO1xuICAgICAgICB2YXIgbmF0aXZlT2JqZWN0ID0gdGhpcy5fc3RvcmUgfHwgdGhpcy5faW5kZXg7XG4gICAgICAgIHZhciByZXF1ZXN0ID0gbmF0aXZlT2JqZWN0W2Z1bmNOYW1lXS5hcHBseShuYXRpdmVPYmplY3QsIGFyZ3Muc2xpY2UoMCwgLTEpKTtcbiAgICAgICAgcmVxdWVzdC5vbnN1Y2Nlc3MgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjYWxsYmFjayhyZXF1ZXN0LnJlc3VsdCk7XG4gICAgICAgIH07XG4gICAgICB9O1xuICAgIH0pO1xuICB9KTtcblxuICAvLyBwb2x5ZmlsbCBnZXRBbGxcbiAgW0luZGV4LCBPYmplY3RTdG9yZV0uZm9yRWFjaChmdW5jdGlvbihDb25zdHJ1Y3Rvcikge1xuICAgIGlmIChDb25zdHJ1Y3Rvci5wcm90b3R5cGUuZ2V0QWxsKSByZXR1cm47XG4gICAgQ29uc3RydWN0b3IucHJvdG90eXBlLmdldEFsbCA9IGZ1bmN0aW9uKHF1ZXJ5LCBjb3VudCkge1xuICAgICAgdmFyIGluc3RhbmNlID0gdGhpcztcbiAgICAgIHZhciBpdGVtcyA9IFtdO1xuXG4gICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSkge1xuICAgICAgICBpbnN0YW5jZS5pdGVyYXRlQ3Vyc29yKHF1ZXJ5LCBmdW5jdGlvbihjdXJzb3IpIHtcbiAgICAgICAgICBpZiAoIWN1cnNvcikge1xuICAgICAgICAgICAgcmVzb2x2ZShpdGVtcyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGl0ZW1zLnB1c2goY3Vyc29yLnZhbHVlKTtcblxuICAgICAgICAgIGlmIChjb3VudCAhPT0gdW5kZWZpbmVkICYmIGl0ZW1zLmxlbmd0aCA9PSBjb3VudCkge1xuICAgICAgICAgICAgcmVzb2x2ZShpdGVtcyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGN1cnNvci5jb250aW51ZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH07XG4gIH0pO1xuXG4gIHZhciBleHAgPSB7XG4gICAgb3BlbjogZnVuY3Rpb24obmFtZSwgdmVyc2lvbiwgdXBncmFkZUNhbGxiYWNrKSB7XG4gICAgICB2YXIgcCA9IHByb21pc2lmeVJlcXVlc3RDYWxsKGluZGV4ZWREQiwgJ29wZW4nLCBbbmFtZSwgdmVyc2lvbl0pO1xuICAgICAgdmFyIHJlcXVlc3QgPSBwLnJlcXVlc3Q7XG5cbiAgICAgIGlmIChyZXF1ZXN0KSB7XG4gICAgICAgIHJlcXVlc3Qub251cGdyYWRlbmVlZGVkID0gZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICBpZiAodXBncmFkZUNhbGxiYWNrKSB7XG4gICAgICAgICAgICB1cGdyYWRlQ2FsbGJhY2sobmV3IFVwZ3JhZGVEQihyZXF1ZXN0LnJlc3VsdCwgZXZlbnQub2xkVmVyc2lvbiwgcmVxdWVzdC50cmFuc2FjdGlvbikpO1xuICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHAudGhlbihmdW5jdGlvbihkYikge1xuICAgICAgICByZXR1cm4gbmV3IERCKGRiKTtcbiAgICAgIH0pO1xuICAgIH0sXG4gICAgZGVsZXRlOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgICByZXR1cm4gcHJvbWlzaWZ5UmVxdWVzdENhbGwoaW5kZXhlZERCLCAnZGVsZXRlRGF0YWJhc2UnLCBbbmFtZV0pO1xuICAgIH1cbiAgfTtcblxuICBpZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IGV4cDtcbiAgICBtb2R1bGUuZXhwb3J0cy5kZWZhdWx0ID0gbW9kdWxlLmV4cG9ydHM7XG4gIH1cbiAgZWxzZSB7XG4gICAgc2VsZi5pZGIgPSBleHA7XG4gIH1cbn0oKSk7XG4iLCIvKipcclxuICogQ29tbW9uIGRhdGFiYXNlIGhlbHBlciBmdW5jdGlvbnMuXHJcbiAqL1xyXG5jbGFzcyBEQkhlbHBlciB7XHJcblxyXG4gIC8qKlxyXG4gICAqIERhdGFiYXNlIFVSTC5cclxuICAgKiBDaGFuZ2UgdGhpcyB0byByZXN0YXVyYW50cy5qc29uIGZpbGUgbG9jYXRpb24gb24geW91ciBzZXJ2ZXIuXHJcbiAgICovXHJcbiAgc3RhdGljIGdldCBEQVRBQkFTRV9VUkwoKSB7XHJcbiAgICBjb25zdCBwb3J0ID0gMTMzNyAvLyBDaGFuZ2UgdGhpcyB0byB5b3VyIHNlcnZlciBwb3J0XHJcbiAgICByZXR1cm4gYGh0dHA6Ly9sb2NhbGhvc3Q6JHtwb3J0fS9yZXN0YXVyYW50c2A7XHJcbiAgfVxyXG5cclxuICAvLyAvKipcclxuICAvLyAgKiBGZXRjaCBhbGwgcmVzdGF1cmFudHMuXHJcbiAgLy8gICovXHJcbiAgLy8gc3RhdGljIGZldGNoUmVzdGF1cmFudHMoY2FsbGJhY2spIHtcclxuICAvLyAgIGxldCB4aHIgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKTtcclxuICAvLyAgIHhoci5vcGVuKCdHRVQnLCBEQkhlbHBlci5EQVRBQkFTRV9VUkwpO1xyXG4gIC8vICAgeGhyLm9ubG9hZCA9ICgpID0+IHtcclxuICAvLyAgICAgaWYgKHhoci5zdGF0dXMgPT09IDIwMCkgeyAvLyBHb3QgYSBzdWNjZXNzIHJlc3BvbnNlIGZyb20gc2VydmVyIVxyXG4gIC8vICAgICAgIGNvbnN0IGpzb24gPSBKU09OLnBhcnNlKHhoci5yZXNwb25zZVRleHQpO1xyXG4gIC8vICAgICAgIGNvbnN0IHJlc3RhdXJhbnRzID0ganNvbi5yZXN0YXVyYW50cztcclxuICAvLyAgICAgICBjYWxsYmFjayhudWxsLCByZXN0YXVyYW50cyk7XHJcbiAgLy8gICAgIH0gZWxzZSB7IC8vIE9vcHMhLiBHb3QgYW4gZXJyb3IgZnJvbSBzZXJ2ZXIuXHJcbiAgLy8gICAgICAgY29uc3QgZXJyb3IgPSAoYFJlcXVlc3QgZmFpbGVkLiBSZXR1cm5lZCBzdGF0dXMgb2YgJHt4aHIuc3RhdHVzfWApO1xyXG4gIC8vICAgICAgIGNhbGxiYWNrKGVycm9yLCBudWxsKTtcclxuICAvLyAgICAgfVxyXG4gIC8vICAgfTtcclxuICAvLyAgIHhoci5zZW5kKCk7XHJcbiAgLy8gfVxyXG5cclxuXHJcblxyXG4gIC8qKlxyXG4gICAqIEZldGNoIGFsbCByZXN0YXVyYW50cy5cclxuICAgKi9cclxuICBzdGF0aWMgZmV0Y2hSZXN0YXVyYW50cyhjYWxsYmFjaykge1xyXG4gICAgY29uc3QgZGJQcm9taXNlID0gaWRiLm9wZW4oJ3Jlc3RhdW50c0RCJywgMSwgZnVuY3Rpb24odXBncmFkZURiKSB7XHJcbiAgICAgIHVwZ3JhZGVEYi5jcmVhdGVPYmplY3RTdG9yZSgncmVzdGF1cmFudHMnICwge1xyXG4gICAgICAgIGtleVBhdGg6ICdpZCdcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBkYlByb21pc2UudGhlbihmdW5jdGlvbihkYikge1xyXG4gICAgICAvLyBjcmVhdGUgdGhlIHRyYW5zYWN0aW9uIGluIHJlYWQvd3JpdGUgb3BlcmF0aW9uIGFuZCBvcGVuIHRoZSBzdG9yZSBmb3IgcmVzdGF1cmFudHNcclxuICAgICAgdmFyIHR4ID0gZGIudHJhbnNhY3Rpb24oJ3Jlc3RhdXJhbnRzJyk7XHJcbiAgICAgIHZhciByZXN0YXVyYW50U3RvcmUgPSB0eC5vYmplY3RTdG9yZSgncmVzdGF1cmFudHMnKTtcclxuICAgICAgcmV0dXJuIHJlc3RhdXJhbnRTdG9yZS5nZXRBbGwoKTtcclxuICAgIH0pLnRoZW4oZnVuY3Rpb24gKHJlc3RhdXJhbnRzKXtcclxuICAgICAgaWYgKHJlc3RhdXJhbnRzLmxlbmd0aCA9PSAwICkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKFwibm8gaGF5IGRhdG9zXCIpO1xyXG4gICAgICAgIC8vIE5vIGRhdGEgb24gQkJERC4gRmV0Y2hpbmcgZnJvbSBvdXIgc2VydmVyXHJcbiAgICAgICAgZmV0Y2goREJIZWxwZXIuREFUQUJBU0VfVVJMKVxyXG4gICAgICAgICAgLnRoZW4ocmVzcG9uc2UgPT4gcmVzcG9uc2UuanNvbigpKVxyXG4gICAgICAgICAgLnRoZW4oZnVuY3Rpb24ocmVzdGF1cmFudHMpIHtcclxuICAgICAgICAgICAgLy8gYWRkaW5nIHRvIGRhdGFiYXNlXHJcbiAgICAgICAgICAgIGRiUHJvbWlzZS50aGVuKCBkYiA9PntcclxuICAgICAgICAgICAgICB2YXIgdHggPSBkYi50cmFuc2FjdGlvbigncmVzdGF1cmFudHMnLCdyZWFkd3JpdGUnKTtcclxuICAgICAgICAgICAgdmFyIHJlc3RhdXJhbnRTdG9yZSA9IHR4Lm9iamVjdFN0b3JlKCdyZXN0YXVyYW50cycpO1xyXG5cclxuICAgICAgICAgICAgcmVzdGF1cmFudHMuZm9yRWFjaChlbGVtZW50ID0+IHtcclxuICAgICAgICAgICAgICByZXN0YXVyYW50U3RvcmUucHV0KGVsZW1lbnQpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCxyZXN0YXVyYW50cyk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgfSlcclxuICAgICAgICAgIC5jYXRjaChmdW5jdGlvbihlcnJvcikge1xyXG4gICAgICAgICAgICBjYWxsYmFjayhlcnJvcixudWxsKTtcclxuICAgICAgICAgIH0pXHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gUmVzdHVhcmFudHMgaW4gREJcclxuICAgICAgICBjYWxsYmFjayhudWxsLHJlc3RhdXJhbnRzKTtcclxuICAgICAgfVxyXG4gICAgfSlcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEZldGNoIGEgcmVzdGF1cmFudCBieSBpdHMgSUQuXHJcbiAgICovXHJcbiAgc3RhdGljIGZldGNoUmVzdGF1cmFudEJ5SWQoaWQsIGNhbGxiYWNrKSB7XHJcbiAgICAvLyBmZXRjaCBhbGwgcmVzdGF1cmFudHMgd2l0aCBwcm9wZXIgZXJyb3IgaGFuZGxpbmcuXHJcbiAgICBEQkhlbHBlci5mZXRjaFJlc3RhdXJhbnRzKChlcnJvciwgcmVzdGF1cmFudHMpID0+IHtcclxuICAgICAgaWYgKGVycm9yKSB7XHJcbiAgICAgICAgY2FsbGJhY2soZXJyb3IsIG51bGwpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGNvbnN0IHJlc3RhdXJhbnQgPSByZXN0YXVyYW50cy5maW5kKHIgPT4gci5pZCA9PSBpZCk7XHJcbiAgICAgICAgaWYgKHJlc3RhdXJhbnQpIHsgLy8gR290IHRoZSByZXN0YXVyYW50XHJcbiAgICAgICAgICBjYWxsYmFjayhudWxsLCByZXN0YXVyYW50KTtcclxuICAgICAgICB9IGVsc2UgeyAvLyBSZXN0YXVyYW50IGRvZXMgbm90IGV4aXN0IGluIHRoZSBkYXRhYmFzZVxyXG4gICAgICAgICAgY2FsbGJhY2soJ1Jlc3RhdXJhbnQgZG9lcyBub3QgZXhpc3QnLCBudWxsKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRmV0Y2ggcmVzdGF1cmFudHMgYnkgYSBjdWlzaW5lIHR5cGUgd2l0aCBwcm9wZXIgZXJyb3IgaGFuZGxpbmcuXHJcbiAgICovXHJcbiAgc3RhdGljIGZldGNoUmVzdGF1cmFudEJ5Q3Vpc2luZShjdWlzaW5lLCBjYWxsYmFjaykge1xyXG4gICAgLy8gRmV0Y2ggYWxsIHJlc3RhdXJhbnRzICB3aXRoIHByb3BlciBlcnJvciBoYW5kbGluZ1xyXG4gICAgREJIZWxwZXIuZmV0Y2hSZXN0YXVyYW50cygoZXJyb3IsIHJlc3RhdXJhbnRzKSA9PiB7XHJcbiAgICAgIGlmIChlcnJvcikge1xyXG4gICAgICAgIGNhbGxiYWNrKGVycm9yLCBudWxsKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICAvLyBGaWx0ZXIgcmVzdGF1cmFudHMgdG8gaGF2ZSBvbmx5IGdpdmVuIGN1aXNpbmUgdHlwZVxyXG4gICAgICAgIGNvbnN0IHJlc3VsdHMgPSByZXN0YXVyYW50cy5maWx0ZXIociA9PiByLmN1aXNpbmVfdHlwZSA9PSBjdWlzaW5lKTtcclxuICAgICAgICBjYWxsYmFjayhudWxsLCByZXN1bHRzKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBGZXRjaCByZXN0YXVyYW50cyBieSBhIG5laWdoYm9yaG9vZCB3aXRoIHByb3BlciBlcnJvciBoYW5kbGluZy5cclxuICAgKi9cclxuICBzdGF0aWMgZmV0Y2hSZXN0YXVyYW50QnlOZWlnaGJvcmhvb2QobmVpZ2hib3Job29kLCBjYWxsYmFjaykge1xyXG4gICAgLy8gRmV0Y2ggYWxsIHJlc3RhdXJhbnRzXHJcbiAgICBEQkhlbHBlci5mZXRjaFJlc3RhdXJhbnRzKChlcnJvciwgcmVzdGF1cmFudHMpID0+IHtcclxuICAgICAgaWYgKGVycm9yKSB7XHJcbiAgICAgICAgY2FsbGJhY2soZXJyb3IsIG51bGwpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vIEZpbHRlciByZXN0YXVyYW50cyB0byBoYXZlIG9ubHkgZ2l2ZW4gbmVpZ2hib3Job29kXHJcbiAgICAgICAgY29uc3QgcmVzdWx0cyA9IHJlc3RhdXJhbnRzLmZpbHRlcihyID0+IHIubmVpZ2hib3Job29kID09IG5laWdoYm9yaG9vZCk7XHJcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgcmVzdWx0cyk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRmV0Y2ggcmVzdGF1cmFudHMgYnkgYSBjdWlzaW5lIGFuZCBhIG5laWdoYm9yaG9vZCB3aXRoIHByb3BlciBlcnJvciBoYW5kbGluZy5cclxuICAgKi9cclxuICBzdGF0aWMgZmV0Y2hSZXN0YXVyYW50QnlDdWlzaW5lQW5kTmVpZ2hib3Job29kKGN1aXNpbmUsIG5laWdoYm9yaG9vZCwgY2FsbGJhY2spIHtcclxuICAgIC8vIEZldGNoIGFsbCByZXN0YXVyYW50c1xyXG4gICAgREJIZWxwZXIuZmV0Y2hSZXN0YXVyYW50cygoZXJyb3IsIHJlc3RhdXJhbnRzKSA9PiB7XHJcbiAgICAgIGlmIChlcnJvcikge1xyXG4gICAgICAgIGNhbGxiYWNrKGVycm9yLCBudWxsKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBsZXQgcmVzdWx0cyA9IHJlc3RhdXJhbnRzO1xyXG4gICAgICAgIGlmIChjdWlzaW5lICE9ICdhbGwnKSB7IC8vIGZpbHRlciBieSBjdWlzaW5lXHJcbiAgICAgICAgICByZXN1bHRzID0gcmVzdWx0cy5maWx0ZXIociA9PiByLmN1aXNpbmVfdHlwZSA9PSBjdWlzaW5lKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKG5laWdoYm9yaG9vZCAhPSAnYWxsJykgeyAvLyBmaWx0ZXIgYnkgbmVpZ2hib3Job29kXHJcbiAgICAgICAgICByZXN1bHRzID0gcmVzdWx0cy5maWx0ZXIociA9PiByLm5laWdoYm9yaG9vZCA9PSBuZWlnaGJvcmhvb2QpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjYWxsYmFjayhudWxsLCByZXN1bHRzKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBGZXRjaCBhbGwgbmVpZ2hib3Job29kcyB3aXRoIHByb3BlciBlcnJvciBoYW5kbGluZy5cclxuICAgKi9cclxuICBzdGF0aWMgZmV0Y2hOZWlnaGJvcmhvb2RzKGNhbGxiYWNrKSB7XHJcbiAgICAvLyBGZXRjaCBhbGwgcmVzdGF1cmFudHNcclxuICAgIERCSGVscGVyLmZldGNoUmVzdGF1cmFudHMoKGVycm9yLCByZXN0YXVyYW50cykgPT4ge1xyXG4gICAgICBpZiAoZXJyb3IpIHtcclxuICAgICAgICBjYWxsYmFjayhlcnJvciwgbnVsbCk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gR2V0IGFsbCBuZWlnaGJvcmhvb2RzIGZyb20gYWxsIHJlc3RhdXJhbnRzXHJcbiAgICAgICAgY29uc3QgbmVpZ2hib3Job29kcyA9IHJlc3RhdXJhbnRzLm1hcCgodiwgaSkgPT4gcmVzdGF1cmFudHNbaV0ubmVpZ2hib3Job29kKVxyXG4gICAgICAgIC8vIFJlbW92ZSBkdXBsaWNhdGVzIGZyb20gbmVpZ2hib3Job29kc1xyXG4gICAgICAgIGNvbnN0IHVuaXF1ZU5laWdoYm9yaG9vZHMgPSBuZWlnaGJvcmhvb2RzLmZpbHRlcigodiwgaSkgPT4gbmVpZ2hib3Job29kcy5pbmRleE9mKHYpID09IGkpXHJcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgdW5pcXVlTmVpZ2hib3Job29kcyk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRmV0Y2ggYWxsIGN1aXNpbmVzIHdpdGggcHJvcGVyIGVycm9yIGhhbmRsaW5nLlxyXG4gICAqL1xyXG4gIHN0YXRpYyBmZXRjaEN1aXNpbmVzKGNhbGxiYWNrKSB7XHJcbiAgICAvLyBGZXRjaCBhbGwgcmVzdGF1cmFudHNcclxuICAgIERCSGVscGVyLmZldGNoUmVzdGF1cmFudHMoKGVycm9yLCByZXN0YXVyYW50cykgPT4ge1xyXG4gICAgICBpZiAoZXJyb3IpIHtcclxuICAgICAgICBjYWxsYmFjayhlcnJvciwgbnVsbCk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gR2V0IGFsbCBjdWlzaW5lcyBmcm9tIGFsbCByZXN0YXVyYW50c1xyXG4gICAgICAgIGNvbnN0IGN1aXNpbmVzID0gcmVzdGF1cmFudHMubWFwKCh2LCBpKSA9PiByZXN0YXVyYW50c1tpXS5jdWlzaW5lX3R5cGUpXHJcbiAgICAgICAgLy8gUmVtb3ZlIGR1cGxpY2F0ZXMgZnJvbSBjdWlzaW5lc1xyXG4gICAgICAgIGNvbnN0IHVuaXF1ZUN1aXNpbmVzID0gY3Vpc2luZXMuZmlsdGVyKCh2LCBpKSA9PiBjdWlzaW5lcy5pbmRleE9mKHYpID09IGkpXHJcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgdW5pcXVlQ3Vpc2luZXMpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFJlc3RhdXJhbnQgcGFnZSBVUkwuXHJcbiAgICovXHJcbiAgc3RhdGljIHVybEZvclJlc3RhdXJhbnQocmVzdGF1cmFudCkge1xyXG4gICAgcmV0dXJuIChgLi9yZXN0YXVyYW50Lmh0bWw/aWQ9JHtyZXN0YXVyYW50LmlkfWApO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogUmVzdGF1cmFudCBpbWFnZSBzcmNzZXQgZm9yIHJlc3BvbnNpdmVzIGltYWdlcy5cclxuICAgKi9cclxuICBzdGF0aWMgaW1hZ2VzU3Jjc2V0Rm9yUmVzdGF1cmFudChyZXN0YXVyYW50KSB7XHJcbiAgICAvLyBhZGRpbmcgYXRyaWJ1dHRlcyBmb3IgcmVzcG9uc2l2ZSBpbWFnZXNcclxuICAgIGNvbnN0IGV4dGVuc2lvbj1cImpwZ1wiOy8vcmVzdGF1cmFudC5waG90b2dyYXBoLm1hdGNoKC9cXC4oW14uXFxcXFxcL10rKSQvKS5wb3AoKTtcclxuICAgIGxldCBmaWxlbmFtZSA9IHJlc3RhdXJhbnQucGhvdG9ncmFwaDsvL3Jlc3RhdXJhbnQucGhvdG9ncmFwaC5yZXBsYWNlKC9cXC4oW14uXFxcXFxcL10rKSQvLCcnKVxyXG4gICAgaWYgKCFmaWxlbmFtZSkgZmlsZW5hbWU9XCIxMFwiO1xyXG4gICAgcmV0dXJuIChgL2ltZy8ke2ZpbGVuYW1lfS1zbWFsbC4ke2V4dGVuc2lvbn0gMjUwdyxcclxuICAgICAgICAgICAgL2ltZy8ke2ZpbGVuYW1lfS1tZWRpdW0uJHtleHRlbnNpb259IDQ2MHcsXHJcbiAgICAgICAgICAgIC9pbWcvJHtmaWxlbmFtZX0tbGFyZ2UuJHtleHRlbnNpb259IDgwMHdgKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFJlc3RhdXJhbnQgaW1hZ2Ugc3Jjc2V0IGZvciByZXNwb25zaXZlcyBpbWFnZXMuXHJcbiAgICovXHJcbiAgc3RhdGljIGltYWdlU2l6ZXNGb3JSZXN0YXVyYW50KGlubmVyKSB7XHJcbiAgICAvLyBhZGRpbmcgYXRyaWJ1dHRlcyBmb3IgcmVzcG9uc2l2ZSBpbWFnZXNcclxuICAgIGlmIChpbm5lcikgcmV0dXJuIGAobWF4LXdpZHRoOiA2MThweCkgY2FsYygxMDB2dyAtIDgwcHgpLCBjYWxjKDUwdncgLSA4MHB4KWA7XHJcbiAgICByZXR1cm4gYChtYXgtd2lkdGg6IDYxOHB4KSBjYWxjKDEwMHZ3IC0gOTBweCksIGNhbGMoNTB2dyAtIDkwcHgpYDtcclxuICB9XHJcblxyXG4gICAvKipcclxuICAgKiBSZXN0YXVyYW50IGltYWdlIHNyY3NldC5cclxuICAgKi9cclxuICBzdGF0aWMgaW1hZ2VVcmxGb3JSZXN0YXVyYW50KHJlc3RhdXJhbnQpIHtcclxuICAgIC8vIGFkZGluZyBhdHJpYnV0dGVzIGZvciByZXNwb25zaXZlIGltYWdlc1xyXG4gICAgY29uc3QgZXh0ZW5zaW9uPVwianBnXCI7Ly9yZXN0YXVyYW50LnBob3RvZ3JhcGgubWF0Y2goL1xcLihbXi5cXFxcXFwvXSspJC8pLnBvcCgpO1xyXG4gICAgbGV0IGZpbGVuYW1lID0gcmVzdGF1cmFudC5waG90b2dyYXBoOy8vcmVzdGF1cmFudC5waG90b2dyYXBoLnJlcGxhY2UoL1xcLihbXi5cXFxcXFwvXSspJC8sJycpXHJcbiAgICBpZiAoIWZpbGVuYW1lKSBmaWxlbmFtZT1cIjEwXCI7XHJcbiAgICByZXR1cm4gKGAvaW1nLyR7ZmlsZW5hbWV9LXNtYWxsLiR7ZXh0ZW5zaW9ufWApO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogTWFwIG1hcmtlciBmb3IgYSByZXN0YXVyYW50LlxyXG4gICAqL1xyXG4gIHN0YXRpYyBtYXBNYXJrZXJGb3JSZXN0YXVyYW50KHJlc3RhdXJhbnQsIG1hcCkge1xyXG4gICAgY29uc3QgbWFya2VyID0gbmV3IGdvb2dsZS5tYXBzLk1hcmtlcih7XHJcbiAgICAgIHBvc2l0aW9uOiByZXN0YXVyYW50LmxhdGxuZyxcclxuICAgICAgdGl0bGU6IHJlc3RhdXJhbnQubmFtZSxcclxuICAgICAgdXJsOiBEQkhlbHBlci51cmxGb3JSZXN0YXVyYW50KHJlc3RhdXJhbnQpLFxyXG4gICAgICBtYXA6IG1hcCxcclxuICAgICAgYW5pbWF0aW9uOiBnb29nbGUubWFwcy5BbmltYXRpb24uRFJPUH1cclxuICAgICk7XHJcbiAgICByZXR1cm4gbWFya2VyO1xyXG4gIH1cclxuXHJcbn1cclxuIl19
