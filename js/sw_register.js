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

}



