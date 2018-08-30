//for compatible browsers
if (navigator.serviceWorker) {
    // REgistering the service worker
    navigator.serviceWorker.register('./sw.js',{
        scope: './'
    }).then(function(reg) {
        console.log('sevice worker registered')
    }).catch(function(err) {
        console.log('error registering...');
    });

    navigator.serviceWorker.ready.then(function(swRegistration) {
        return swRegistration.sync.register('sendPendingPost');
      });

    window.addEventListener('online', function () {
        navigator.serviceWorker.controller.postMessage('online');
        console.log("online");
    })

    /*navigator.serviceWorker.addEventListener('message', function(event) {
        console.log(`Mensaje: ${eventa.data}`);
    })*/

   /* window.addEventListener('load', function() {
        var status = document.getElementById("status");
        var log = document.getElementById("log");

        function updateOnlineStatus(event) {
          var condition = navigator.onLine ? "online" : "offline";

          status.className = condition;
          status.innerHTML = condition.toUpperCase();

          log.insertAdjacentHTML("beforeend", "Event: " + event.type + "; Status: " + condition);
        }

        window.addEventListener('online',  updateOnlineStatus);
        window.addEventListener('offline', updateOnlineStatus);
      });*/
}



