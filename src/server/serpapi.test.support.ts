export function serpResponse(){
  return {search_metadata:{id:"fixture",status:"Success",json_endpoint:"https://serpapi.com/searches/fixture.json?api_key=OFFLINE-SERP"},
    images_results:[0,1,2].map(i=>({position:i+1,title:`Movie reaction fixture ${i}`,
      thumbnail:`https://serpapi.com/searches/fixture/images/image${i}.jpeg`,
      link:`https://example.com/scene${i}`,original:`https://original.example.com/image${i}.jpg`,
      source:"Fixture publisher",original_width:1600,original_height:1200}))};
}
